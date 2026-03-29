// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RBTCGasStation
 * @notice Pre-funded RBTC Gas Station on Rootstock Testnet.
 *         Users pay with USDRIF or RIF and receive RBTC instantly.
 * @dev Owner pre-funds the contract with RBTC. Exchange rates are
 *      set by the owner (oracle integration is a future step).
 */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract RBTCGasStation {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;

    /// @notice Supported token addresses
    address public usdrifToken;
    address public rifToken;

    /// @notice How many token wei the user must pay per 1 RBTC wei
    /// e.g. if 1 RBTC = 3000 USDRIF, rate = 3000 * 10^18 (18-decimal token)
    uint256 public usdrifPerRBTC; // token units per 1 RBTC (in wei)
    uint256 public rifPerRBTC;    // token units per 1 RBTC (in wei)

    /// @notice Swap fee in basis points (100 = 1%)
    uint256 public feeBps;

    /// @notice Minimum RBTC output per swap (safety floor)
    uint256 public minRBTCOut;

    /// @notice Maximum RBTC output per swap (rate-manipulation guard)
    uint256 public maxRBTCOut;

    bool public paused;

    // ── Events ───────────────────────────────────────────────────────────────

    event Swapped(
        address indexed user,
        address indexed tokenIn,
        uint256 tokenAmountIn,
        uint256 rbtcAmountOut,
        uint256 feeRBTC
    );
    event RateUpdated(address indexed token, uint256 newRate);
    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "GasStation: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "GasStation: paused");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _usdrifToken  USDRIF token contract address on RSK testnet
     * @param _rifToken     RIF token contract address on RSK testnet
     * @param _usdrifPerRBTC  Initial rate: USDRIF (wei) per 1 RBTC (wei)
     * @param _rifPerRBTC     Initial rate: RIF (wei) per 1 RBTC (wei)
     * @param _feeBps         Swap fee in basis points (e.g. 50 = 0.5%)
     * @param _minRBTCOut     Minimum RBTC out per swap (wei)
     * @param _maxRBTCOut     Maximum RBTC out per swap (wei)
     */
    constructor(
        address _usdrifToken,
        address _rifToken,
        uint256 _usdrifPerRBTC,
        uint256 _rifPerRBTC,
        uint256 _feeBps,
        uint256 _minRBTCOut,
        uint256 _maxRBTCOut
    ) {
        require(_usdrifToken != address(0), "GasStation: zero usdrif addr");
        require(_rifToken != address(0),    "GasStation: zero rif addr");
        require(_feeBps < 10_000,           "GasStation: fee >= 100%");
        require(_minRBTCOut <= _maxRBTCOut, "GasStation: min > max");

        owner          = msg.sender;
        usdrifToken    = _usdrifToken;
        rifToken       = _rifToken;
        usdrifPerRBTC  = _usdrifPerRBTC;
        rifPerRBTC     = _rifPerRBTC;
        feeBps         = _feeBps;
        minRBTCOut     = _minRBTCOut;
        maxRBTCOut     = _maxRBTCOut;
    }

    // ── Funding ──────────────────────────────────────────────────────────────

    /// @notice Owner (or anyone) can top up the RBTC reserve
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ── Core Swap ────────────────────────────────────────────────────────────

    /**
     * @notice Swap USDRIF for RBTC.
     * @param tokenAmountIn  Exact amount of USDRIF (in token wei) the user pays.
     * @param minRBTCExpected  Slippage guard: revert if RBTC out is less than this.
     */
    function swapUSDRIFForRBTC(uint256 tokenAmountIn, uint256 minRBTCExpected)
        external
        whenNotPaused
    {
        _swap(usdrifToken, usdrifPerRBTC, tokenAmountIn, minRBTCExpected);
    }

    /**
     * @notice Swap RIF for RBTC.
     * @param tokenAmountIn  Exact amount of RIF (in token wei) the user pays.
     * @param minRBTCExpected  Slippage guard: revert if RBTC out is less than this.
     */
    function swapRIFForRBTC(uint256 tokenAmountIn, uint256 minRBTCExpected)
        external
        whenNotPaused
    {
        _swap(rifToken, rifPerRBTC, tokenAmountIn, minRBTCExpected);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    function _swap(
        address token,
        uint256 rateTokenPerRBTC,
        uint256 tokenAmountIn,
        uint256 minRBTCExpected
    ) internal {
        require(tokenAmountIn > 0,           "GasStation: zero input");
        require(rateTokenPerRBTC > 0,        "GasStation: rate not set");

        // Gross RBTC out before fee
        // rbtcOut = tokenAmountIn * 1e18 / rateTokenPerRBTC
        // (both token and RBTC are 18-decimal; rate is token-wei per rbtc-wei)
        uint256 rbtcGross = (tokenAmountIn * 1 ether) / rateTokenPerRBTC;

        // Deduct fee
        uint256 feeRBTC  = (rbtcGross * feeBps) / 10_000;
        uint256 rbtcOut  = rbtcGross - feeRBTC;

        require(rbtcOut >= minRBTCOut,       "GasStation: below min output");
        require(rbtcOut <= maxRBTCOut,       "GasStation: above max output");
        require(rbtcOut >= minRBTCExpected,  "GasStation: slippage exceeded");
        require(address(this).balance >= rbtcOut, "GasStation: insufficient RBTC reserve");

        // Pull tokens from user (user must have approved this contract first)
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), tokenAmountIn);
        require(ok, "GasStation: token transfer failed");

        // Send RBTC to user
        (bool sent, ) = payable(msg.sender).call{value: rbtcOut}("");
        require(sent, "GasStation: RBTC send failed");

        emit Swapped(msg.sender, token, tokenAmountIn, rbtcOut, feeRBTC);
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    /**
     * @notice Calculate how much RBTC the user will receive for a given token amount.
     * @param token          Must be usdrifToken or rifToken.
     * @param tokenAmountIn  Token amount in wei.
     * @return rbtcOut       RBTC out after fee, in wei.
     * @return feeRBTC       Fee portion in RBTC wei.
     */
    function quoteRBTCOut(address token, uint256 tokenAmountIn)
        external
        view
        returns (uint256 rbtcOut, uint256 feeRBTC)
    {
        uint256 rate = _rateFor(token);
        require(rate > 0, "GasStation: unsupported token");
        uint256 gross = (tokenAmountIn * 1 ether) / rate;
        feeRBTC = (gross * feeBps) / 10_000;
        rbtcOut = gross - feeRBTC;
    }

    /**
     * @notice How much token the user needs to pay to receive exactly `rbtcWanted` wei.
     */
    function quoteTokenIn(address token, uint256 rbtcWanted)
        external
        view
        returns (uint256 tokenIn)
    {
        uint256 rate = _rateFor(token);
        require(rate > 0, "GasStation: unsupported token");
        // rbtcWanted is net of fee, so gross = rbtcWanted / (1 - feeBps/10000)
        uint256 grossRBTC = (rbtcWanted * 10_000) / (10_000 - feeBps);
        tokenIn = (grossRBTC * rate) / 1 ether;
    }

    function rbtcReserve() external view returns (uint256) {
        return address(this).balance;
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ── Owner Admin ──────────────────────────────────────────────────────────

    function setUSDRIFRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "GasStation: zero rate");
        usdrifPerRBTC = newRate;
        emit RateUpdated(usdrifToken, newRate);
    }

    function setRIFRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "GasStation: zero rate");
        rifPerRBTC = newRate;
        emit RateUpdated(rifToken, newRate);
    }

    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps < 10_000, "GasStation: fee >= 100%");
        feeBps = _feeBps;
    }

    function setLimits(uint256 _minRBTCOut, uint256 _maxRBTCOut) external onlyOwner {
        require(_minRBTCOut <= _maxRBTCOut, "GasStation: min > max");
        minRBTCOut = _minRBTCOut;
        maxRBTCOut = _maxRBTCOut;
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedSet(_paused);
    }

    /// @notice Withdraw collected tokens to owner
    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        bool ok = IERC20(token).transfer(owner, amount);
        require(ok, "GasStation: withdraw failed");
        emit Withdrawn(token, amount);
    }

    /// @notice Withdraw RBTC reserve to owner
    function withdrawRBTC(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "GasStation: insufficient balance");
        (bool sent, ) = payable(owner).call{value: amount}("");
        require(sent, "GasStation: RBTC withdraw failed");
        emit Withdrawn(address(0), amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "GasStation: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    function _rateFor(address token) internal view returns (uint256) {
        if (token == usdrifToken) return usdrifPerRBTC;
        if (token == rifToken)    return rifPerRBTC;
        return 0;
    }
}
