// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================================
//  RBTCRefuel — Gas Station for Rootstock Users
//  Users pay in USDRIF or RIF and receive RBTC instantly.
//
//  Network  : Rootstock (RSK) Testnet / Mainnet
//  Solidity : ^0.8.20
//  License  : MIT
//
//  Architecture:
//    - Owner pre-funds contract with RBTC
//    - Owner sets and updates exchange rates (RBTC per token)
//    - Users call refuel() to swap USDRIF or RIF for RBTC
//    - Fee collected in input tokens, withdrawn by owner
//    - Reentrancy-guarded, pausable, two-step ownership transfer
//
//  Security properties:
//    - Manual reentrancy guard (no external dependency)
//    - Checks-Effects-Interactions pattern in refuel()
//    - onlyOwner on all admin functions
//    - notPaused on user-facing swap
//    - Custom errors (gas-cheaper than require strings)
//    - Overflow protection via Solidity ^0.8 built-ins
//    - No delegatecall, no selfdestruct, no upgradeable proxy
// ============================================================================


// ─────────────────────────────────────────────────────────────────────────────
// Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @dev Minimal ERC-20 interface used by this contract.
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}


// ─────────────────────────────────────────────────────────────────────────────
// Custom Errors  (EIP-838 — cheaper gas than revert strings)
// ─────────────────────────────────────────────────────────────────────────────

error NotOwner();
error NotPendingOwner();
error ZeroAddress();
error SameOwner();
error ContractPaused();
error UnsupportedToken(address token);
error ZeroAmount();
error ZeroRate();
error FeeTooHigh(uint256 provided, uint256 maximum);
error InvalidLimits(uint256 min, uint256 max);
error RateQuotesZeroRbtc();
error SlippageExceeded(uint256 netRbtc, uint256 minExpected);
error BelowMinimumSwap(uint256 netRbtc, uint256 minimum);
error ExceedsMaximumSwap(uint256 netRbtc, uint256 maximum);
error InsufficientRBTCReserve(uint256 required, uint256 available);
error ExceedsContractBalance(uint256 requested, uint256 available);
error TokenTransferFailed();
error RBTCTransferFailed();
error WithdrawFailed();
error ReentrantCall();


// ─────────────────────────────────────────────────────────────────────────────
// RBTCRefuel
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  RBTCRefuel
 * @author RBTC Refuel Team
 * @notice Gas station on Rootstock. Users pay USDRIF or RIF, receive RBTC.
 *
 * @dev    Rate model
 *         ──────────
 *         Rates are stored as "RBTC wei per 1 full token (1e18 wei)".
 *
 *         Example — BTC at $70,000, RIF at $0.09:
 *           rbtcPerUsdRif = 1e18 / 70_000          ≈ 14_285_714_285 wei
 *           rbtcPerRif    = (0.09 / 70_000) * 1e18 ≈  1_285_714_285 wei
 *
 *         Swap math:
 *           grossRbtc = (tokenAmountWei * rate) / 1e18
 *           feeRbtc   = (grossRbtc * feeBps) / 10_000
 *           netRbtc   = grossRbtc - feeRbtc
 *
 *         Fee model
 *         ─────────
 *         Fee is deducted from the gross RBTC output (not from token input).
 *         The full token amount is pulled into the contract; collected tokens
 *         accumulate and are withdrawn by the owner via withdrawTokens().
 */
contract RBTCRefuel {

    // ─────────────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Hard cap on the swap fee: 5% (500 basis points).
    uint256 public constant MAX_FEE_BPS = 500;

    /// @notice Basis-point denominator.
    uint256 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Precision scalar for rate arithmetic (18-decimal tokens).
    uint256 public constant PRECISION = 1e18;

    // ─────────────────────────────────────────────────────────────────────────
    // Immutable token addresses  (set once at deploy, then fixed)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice USDRIF token address on this network.
    address public immutable USDRIF;

    /// @notice RIF token address on this network.
    address public immutable RIF;

    // ─────────────────────────────────────────────────────────────────────────
    // Ownership
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Current contract owner.
    address public owner;

    /**
     * @notice Nominated next owner (two-step transfer).
     *         Zero address means no transfer is pending.
     */
    address public pendingOwner;

    // ─────────────────────────────────────────────────────────────────────────
    // Control flags
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice When true all user swaps are blocked. Owner can still withdraw.
    bool public paused;

    /// @dev Reentrancy guard: 1 = unlocked, 2 = locked.
    uint256 private _lock;

    // ─────────────────────────────────────────────────────────────────────────
    // Rates & fees
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice RBTC wei paid per 1 USDRIF wei. Updated by owner to track market.
    uint256 public rbtcPerUsdRif;

    /// @notice RBTC wei paid per 1 RIF wei. Updated by owner to track market.
    uint256 public rbtcPerRif;

    /// @notice Swap fee in basis points (e.g. 50 = 0.5%). Max MAX_FEE_BPS.
    uint256 public feeBps;

    // ─────────────────────────────────────────────────────────────────────────
    // Swap limits
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Minimum net RBTC (after fee) per single swap, in wei.
    uint256 public minRbtcOut;

    /// @notice Maximum net RBTC (after fee) per single swap, in wei.
    uint256 public maxRbtcOut;

    // ─────────────────────────────────────────────────────────────────────────
    // Accounting / analytics
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Total RBTC dispensed to users across all swaps (wei).
    uint256 public totalRbtcDispensed;

    /// @notice Total number of successful swaps processed.
    uint256 public totalSwaps;

    /// @notice Accumulated USDRIF fee tokens not yet withdrawn (wei).
    uint256 public pendingFeeUsdRif;

    /// @notice Accumulated RIF fee tokens not yet withdrawn (wei).
    uint256 public pendingFeeRif;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Fired on every successful swap.
     * @param user         Caller who received RBTC.
     * @param tokenIn      Token paid by the user (USDRIF or RIF).
     * @param tokenAmount  Token amount paid (wei).
     * @param rbtcOut      Net RBTC sent to user (wei).
     * @param feeRbtc      RBTC-equivalent fee deducted (wei, informational).
     */
    event Refueled(
        address indexed user,
        address indexed tokenIn,
        uint256         tokenAmount,
        uint256         rbtcOut,
        uint256         feeRbtc
    );

    event RatesUpdated(
        uint256 rbtcPerUsdRif,
        uint256 rbtcPerRif,
        address indexed updatedBy
    );

    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);

    event LimitsUpdated(uint256 minRbtcOut, uint256 maxRbtcOut);

    event ReserveFunded(address indexed sender, uint256 amount);

    event RbtcWithdrawn(address indexed to, uint256 amount);

    event TokensWithdrawn(
        address indexed token,
        address indexed to,
        uint256 amount
    );

    event PausedStateChanged(bool paused, address indexed changedBy);

    event OwnershipTransferInitiated(
        address indexed currentOwner,
        address indexed pendingOwner
    );

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier notPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    /**
     * @dev Manual reentrancy guard.
     *      Uses a uint256 flag rather than a bool to match the OpenZeppelin
     *      ReentrancyGuard pattern (avoids cold-storage gas penalty on unlock).
     */
    modifier nonReentrant() {
        if (_lock == 2) revert ReentrantCall();
        _lock = 2;
        _;
        _lock = 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deploy RBTCRefuel and optionally pre-fund the RBTC reserve.
     *
     * @param _usdrif          USDRIF token address on this network.
     * @param _rif             RIF token address on this network.
     * @param _rbtcPerUsdRif   Initial rate — RBTC wei per 1e18 USDRIF wei.
     * @param _rbtcPerRif      Initial rate — RBTC wei per 1e18 RIF wei.
     * @param _feeBps          Initial fee in basis points (50 = 0.5%).
     * @param _minRbtcOut      Minimum net RBTC per swap (wei).
     * @param _maxRbtcOut      Maximum net RBTC per swap (wei).
     *
     * @dev    Constructor is payable so the deployer can fund the RBTC reserve
     *         in the same transaction as deployment (saves one extra tx).
     */
    constructor(
        address _usdrif,
        address _rif,
        uint256 _rbtcPerUsdRif,
        uint256 _rbtcPerRif,
        uint256 _feeBps,
        uint256 _minRbtcOut,
        uint256 _maxRbtcOut
    ) payable {
        if (_usdrif == address(0))           revert ZeroAddress();
        if (_rif    == address(0))           revert ZeroAddress();
        if (_rbtcPerUsdRif == 0)             revert ZeroRate();
        if (_rbtcPerRif    == 0)             revert ZeroRate();
        if (_feeBps > MAX_FEE_BPS)           revert FeeTooHigh(_feeBps, MAX_FEE_BPS);
        if (_minRbtcOut >= _maxRbtcOut)      revert InvalidLimits(_minRbtcOut, _maxRbtcOut);

        owner          = msg.sender;
        USDRIF         = _usdrif;
        RIF            = _rif;
        rbtcPerUsdRif  = _rbtcPerUsdRif;
        rbtcPerRif     = _rbtcPerRif;
        feeBps         = _feeBps;
        minRbtcOut     = _minRbtcOut;
        maxRbtcOut     = _maxRbtcOut;
        _lock          = 1;

        if (msg.value > 0) {
            emit ReserveFunded(msg.sender, msg.value);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Receive  — anyone can top up the RBTC reserve by sending RBTC here
    // ─────────────────────────────────────────────────────────────────────────

    receive() external payable {
        if (msg.value > 0) {
            emit ReserveFunded(msg.sender, msg.value);
        }
    }

    // =========================================================================
    //  USER FUNCTION
    // =========================================================================

    /**
     * @notice Swap USDRIF or RIF for RBTC.
     *
     * @param token            Token to pay with — must be USDRIF or RIF.
     * @param tokenAmount      Amount of `token` in wei (18 decimals).
     * @param minRbtcExpected  Minimum RBTC the caller will accept (slippage guard).
     *                         Pass 0 to skip the check (not recommended for UIs).
     *
     * @dev    The caller must first approve this contract to spend `tokenAmount`
     *         of `token`:  token.approve(address(this), tokenAmount)
     *
     *         Call pattern — Checks → Effects → Interactions:
     *           1. Validate all inputs and preconditions       [Checks]
     *           2. Calculate amounts                           [Checks]
     *           3. Write to state (accounting)                 [Effects]
     *           4. transferFrom — pull tokens from caller      [Interaction]
     *           5. call{value} — push RBTC to caller           [Interaction]
     *
     *         This ordering ensures state is committed before external calls,
     *         eliminating reentrancy risk even without the guard — but we keep
     *         the guard as defence-in-depth.
     */
    function refuel(
        address token,
        uint256 tokenAmount,
        uint256 minRbtcExpected
    )
        external
        notPaused
        nonReentrant
    {
        // ── 1. Checks ─────────────────────────────────────────────────────────

        if (token != USDRIF && token != RIF) revert UnsupportedToken(token);
        if (tokenAmount == 0)                revert ZeroAmount();

        uint256 rate      = (token == USDRIF) ? rbtcPerUsdRif : rbtcPerRif;
        uint256 grossRbtc = (tokenAmount * rate) / PRECISION;
        if (grossRbtc == 0) revert RateQuotesZeroRbtc();

        uint256 feeRbtc = (grossRbtc * feeBps) / BPS_DENOMINATOR;
        uint256 netRbtc = grossRbtc - feeRbtc;

        // Slippage check
        if (minRbtcExpected > 0 && netRbtc < minRbtcExpected) {
            revert SlippageExceeded(netRbtc, minRbtcExpected);
        }

        // Swap-limit checks
        if (netRbtc < minRbtcOut) revert BelowMinimumSwap(netRbtc, minRbtcOut);
        if (netRbtc > maxRbtcOut) revert ExceedsMaximumSwap(netRbtc, maxRbtcOut);

        // Reserve check
        if (address(this).balance < netRbtc) {
            revert InsufficientRBTCReserve(netRbtc, address(this).balance);
        }

        // Token-fee portion (proportional to fee share of gross output)
        uint256 tokenFee = (grossRbtc > 0)
            ? (tokenAmount * feeRbtc) / grossRbtc
            : 0;

        // ── 2. Effects ────────────────────────────────────────────────────────

        totalRbtcDispensed += netRbtc;
        unchecked { totalSwaps += 1; }   // totalSwaps overflow: ~1.8e19 swaps needed

        if (token == USDRIF) {
            pendingFeeUsdRif += tokenFee;
        } else {
            pendingFeeRif    += tokenFee;
        }

        // ── 3. Interactions ───────────────────────────────────────────────────

        // Pull tokens from user
        bool pulled = IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);
        if (!pulled) revert TokenTransferFailed();

        // Send RBTC to user (low-level call forwards all remaining gas, no gas cap)
        (bool sent, ) = payable(msg.sender).call{value: netRbtc}("");
        if (!sent) revert RBTCTransferFailed();

        emit Refueled(msg.sender, token, tokenAmount, netRbtc, feeRbtc);
    }

    // =========================================================================
    //  READ-ONLY HELPERS  (zero gas — callable from frontend)
    // =========================================================================

    /**
     * @notice Preview a swap without executing it.
     *
     * @param token        Token address (USDRIF or RIF).
     * @param tokenAmount  Amount to pay (wei).
     *
     * @return grossRbtc    RBTC before fee (wei).
     * @return feeRbtc      RBTC taken as fee (wei).
     * @return netRbtc      RBTC the caller would receive (wei).
     * @return withinLimits True when netRbtc is within [minRbtcOut, maxRbtcOut].
     * @return hasReserve   True when the contract holds enough RBTC to pay out.
     */
    function quoteRefuel(address token, uint256 tokenAmount)
        external
        view
        returns (
            uint256 grossRbtc,
            uint256 feeRbtc,
            uint256 netRbtc,
            bool    withinLimits,
            bool    hasReserve
        )
    {
        if (token != USDRIF && token != RIF) revert UnsupportedToken(token);
        if (tokenAmount == 0)                revert ZeroAmount();

        uint256 rate = (token == USDRIF) ? rbtcPerUsdRif : rbtcPerRif;
        grossRbtc    = (tokenAmount * rate) / PRECISION;
        feeRbtc      = (grossRbtc * feeBps) / BPS_DENOMINATOR;
        netRbtc      = grossRbtc - feeRbtc;
        withinLimits = (netRbtc >= minRbtcOut && netRbtc <= maxRbtcOut);
        hasReserve   = (address(this).balance >= netRbtc);
    }

    /// @notice RBTC held in the reserve (wei).
    function rbtcReserve() external view returns (uint256) {
        return address(this).balance;
    }

    /// @notice USDRIF held in the contract (collected fees + any excess) (wei).
    function usdrifBalance() external view returns (uint256) {
        return IERC20(USDRIF).balanceOf(address(this));
    }

    /// @notice RIF held in the contract (collected fees + any excess) (wei).
    function rifBalance() external view returns (uint256) {
        return IERC20(RIF).balanceOf(address(this));
    }

    /**
     * @notice Returns the full contract state in a single RPC call.
     * @dev    Convenience function for frontend dashboards — avoids multiple
     *         individual eth_call requests.
     */
    function getContractState()
        external
        view
        returns (
            bool    _paused,
            uint256 _rbtcReserve,
            uint256 _rbtcPerUsdRif,
            uint256 _rbtcPerRif,
            uint256 _feeBps,
            uint256 _minRbtcOut,
            uint256 _maxRbtcOut,
            uint256 _totalSwaps,
            uint256 _totalRbtcDispensed,
            uint256 _pendingFeeUsdRif,
            uint256 _pendingFeeRif
        )
    {
        return (
            paused,
            address(this).balance,
            rbtcPerUsdRif,
            rbtcPerRif,
            feeBps,
            minRbtcOut,
            maxRbtcOut,
            totalSwaps,
            totalRbtcDispensed,
            pendingFeeUsdRif,
            pendingFeeRif
        );
    }

    // =========================================================================
    //  OWNER — RATE MANAGEMENT
    // =========================================================================

    /**
     * @notice Update exchange rates to reflect the current market.
     * @dev    The owner (or a trusted keeper script) calls this whenever the
     *         market moves beyond an acceptable threshold (e.g. ±1%).
     *         On-chain oracle integration is the planned upgrade path.
     *
     * @param _rbtcPerUsdRif  New USDRIF rate (RBTC wei per 1e18 USDRIF wei).
     * @param _rbtcPerRif     New RIF rate    (RBTC wei per 1e18 RIF wei).
     */
    function setRates(uint256 _rbtcPerUsdRif, uint256 _rbtcPerRif)
        external
        onlyOwner
    {
        if (_rbtcPerUsdRif == 0) revert ZeroRate();
        if (_rbtcPerRif    == 0) revert ZeroRate();

        rbtcPerUsdRif = _rbtcPerUsdRif;
        rbtcPerRif    = _rbtcPerRif;

        emit RatesUpdated(_rbtcPerUsdRif, _rbtcPerRif, msg.sender);
    }

    // =========================================================================
    //  OWNER — FEE MANAGEMENT
    // =========================================================================

    /**
     * @notice Update the swap fee.
     * @param _feeBps  New fee in basis points. Hard-capped at MAX_FEE_BPS (500).
     */
    function setFee(uint256 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh(_feeBps, MAX_FEE_BPS);

        uint256 old = feeBps;
        feeBps = _feeBps;

        emit FeeUpdated(old, _feeBps);
    }

    // =========================================================================
    //  OWNER — SWAP LIMITS
    // =========================================================================

    /**
     * @notice Update per-swap RBTC output limits.
     * @param _minRbtcOut  New minimum net RBTC (wei). Must be < _maxRbtcOut.
     * @param _maxRbtcOut  New maximum net RBTC (wei).
     */
    function setLimits(uint256 _minRbtcOut, uint256 _maxRbtcOut) external onlyOwner {
        if (_minRbtcOut >= _maxRbtcOut) revert InvalidLimits(_minRbtcOut, _maxRbtcOut);

        minRbtcOut = _minRbtcOut;
        maxRbtcOut = _maxRbtcOut;

        emit LimitsUpdated(_minRbtcOut, _maxRbtcOut);
    }

    // =========================================================================
    //  OWNER — PAUSE
    // =========================================================================

    /**
     * @notice Pause or unpause user swaps.
     * @dev    Use in emergencies (e.g. rate oracle failure, reserve critically low,
     *         smart-contract vulnerability discovered).
     *         Owner withdraw functions remain available while paused.
     * @param _paused  True to pause, false to resume.
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedStateChanged(_paused, msg.sender);
    }

    // =========================================================================
    //  OWNER — RESERVE & FEE WITHDRAWAL
    // =========================================================================

    /**
     * @notice Withdraw RBTC from the reserve to the owner wallet.
     * @dev    nonReentrant as a precaution even though onlyOwner already
     *         restricts callers. Defence-in-depth.
     * @param amount  RBTC to withdraw (wei). Cannot exceed contract balance.
     */
    function withdrawRbtc(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0)                    revert ZeroAmount();
        if (amount > address(this).balance) {
            revert ExceedsContractBalance(amount, address(this).balance);
        }

        (bool sent, ) = payable(owner).call{value: amount}("");
        if (!sent) revert WithdrawFailed();

        emit RbtcWithdrawn(owner, amount);
    }

    /**
     * @notice Withdraw any ERC-20 token held by the contract to the owner wallet.
     * @dev    Covers collected USDRIF/RIF fees and any accidental token sends.
     * @param token   ERC-20 token address to withdraw.
     * @param amount  Amount to withdraw (wei).
     */
    function withdrawTokens(address token, uint256 amount)
        external
        onlyOwner
        nonReentrant
    {
        if (token  == address(0)) revert ZeroAddress();
        if (amount == 0)          revert ZeroAmount();

        uint256 bal = IERC20(token).balanceOf(address(this));
        if (amount > bal) revert ExceedsContractBalance(amount, bal);

        // Adjust pending-fee counters for tracked tokens
        if (token == USDRIF) {
            pendingFeeUsdRif = (amount >= pendingFeeUsdRif) ? 0 : pendingFeeUsdRif - amount;
        } else if (token == RIF) {
            pendingFeeRif    = (amount >= pendingFeeRif)    ? 0 : pendingFeeRif    - amount;
        }

        bool ok = IERC20(token).transfer(owner, amount);
        if (!ok) revert TokenTransferFailed();

        emit TokensWithdrawn(token, owner, amount);
    }

    // =========================================================================
    //  OWNER — TWO-STEP OWNERSHIP TRANSFER
    // =========================================================================

    /**
     * @notice Step 1: nominate a new owner.
     * @dev    The new owner must call acceptOwnership() to complete the transfer.
     *         Prevents accidental transfer to a wrong or uncontrolled address.
     * @param newOwner  Address of the proposed new owner.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner)      revert SameOwner();

        pendingOwner = newOwner;
        emit OwnershipTransferInitiated(owner, newOwner);
    }

    /**
     * @notice Step 2: accept the ownership nomination.
     * @dev    Must be called by pendingOwner, not the current owner.
     */
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();

        address previous = owner;
        owner        = pendingOwner;
        pendingOwner = address(0);

        emit OwnershipTransferred(previous, owner);
    }

    /**
     * @notice Cancel a pending ownership transfer before it is accepted.
     */
    function cancelOwnershipTransfer() external onlyOwner {
        pendingOwner = address(0);
    }
}
