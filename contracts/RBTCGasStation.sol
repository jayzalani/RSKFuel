// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title RBTCGasStation
 * @notice Pre-funded RBTC Gas Station on Rootstock.
 *         Users pay with USDRIF or RIF and receive RBTC instantly, priced
 *         off a live on-chain oracle instead of an owner-set manual rate.
 *
 * @dev PRICE FEED CONVENTION — READ BEFORE DEPLOYING WITH REAL FUNDS:
 *      Each price feed passed in here MUST return, via peek(), "how many
 *      token-wei the user must pay per 1 RBTC-wei", scaled to 1e18 — the
 *      exact same units the old manual `usdrifPerRBTC` / `rifPerRBTC`
 *      variables used.
 *
 *      Most RSK oracles (e.g. Money On Chain's IMoCBaseOracle) publish a
 *      USD/BTC price, not a token-per-RBTC price directly. So:
 *        - For a USD-pegged token (USDRIF, if it holds ~$1), an RBTC/USD
 *          feed's price IS approximately your usdrifPerRBTC rate.
 *        - For a non-USD-pegged token (RIF), you will likely need a small
 *          adapter contract that combines an RBTC/USD feed and a RIF/USD
 *          feed into a single "RIF per RBTC" cross-rate, then implements
 *          this same peek() interface so it can be dropped in below.
 *      Verify the exact units/decimals of whatever real feed address you
 *      wire in against ITS OWN docs before mainnet. A unit mismatch here
 *      mispricess every swap with real money.
 */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @dev Standard interface used by Money On Chain / most RSK price oracles.
interface IMoCBaseOracle {
    /// @return price Latest price, bytes32-encoded uint256, 1e18-scaled.
    /// @return valid False if the oracle itself considers this reading
    ///                stale or unreliable — callers MUST treat valid ==
    ///                false as "no usable price right now", never fall
    ///                back to it silently.
    function peek() external view returns (bytes32 price, bool valid);
}

contract RBTCGasStation is ReentrancyGuard {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;

    address public usdrifToken;
    address public rifToken;

    /// @notice Live oracle feeds. address(0) means "no oracle wired up for this token".
    IMoCBaseOracle public usdrifPriceFeed;
    IMoCBaseOracle public rifPriceFeed;

    /// @notice Emergency manual fallback rate — only used while that token's
    /// oracle mode is switched off. Same units as before: token-wei per 1 RBTC-wei.
    uint256 public manualUsdrifPerRBTC;
    uint256 public manualRifPerRBTC;

    bool public usdrifOracleEnabled;
    bool public rifOracleEnabled;

    /// @notice Circuit breaker: max allowed move (in bps) between the last
    /// rate this contract actually used and a fresh oracle reading, before
    /// swaps for that token pause and wait for owner review.
    uint256 public maxDeviationBps = 1000; // 10% default — tune before mainnet

    /// @notice Last rate actually used to price a swap, per token (circuit
    /// breaker baseline).
    uint256 public lastUsdrifRate;
    uint256 public lastRifRate;

    uint256 public feeBps;
    uint256 public minRBTCOut;
    uint256 public maxRBTCOut;

    bool public paused;

    /// @notice A separate, lower-privilege address allowed to push rate
    /// updates (e.g. an automated price-keeper bot). Deliberately CANNOT
    /// withdraw funds, change fees, or do anything owner can — limits the
    /// blast radius of a key that has to live on an always-running server.
    address public priceUpdater;

    // ── Events ───────────────────────────────────────────────────────────────

    event Swapped(address indexed user, address indexed tokenIn, uint256 tokenAmountIn, uint256 rbtcAmountOut, uint256 feeRBTC);
    event RateUpdated(address indexed token, uint256 newRate);
    event PriceFeedUpdated(address indexed token, address feed);
    event OracleModeSet(address indexed token, bool enabled);
    event CircuitBreakerTripped(address indexed token, uint256 lastRate, uint256 attemptedRate);
    event RateAcknowledged(address indexed token, uint256 newBaselineRate);
    event Funded(address indexed funder, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount);
    event PausedSet(bool paused);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event PriceUpdaterChanged(address indexed oldUpdater, address indexed newUpdater);

    // ── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "GasStation: not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "GasStation: paused");
        _;
    }

    modifier onlyOwnerOrUpdater() {
        require(msg.sender == owner || msg.sender == priceUpdater, "GasStation: not authorized");
        _;
    }

    // ── Constructor ──────────────────────────────────────────────────────────

    /**
     * @param _usdrifToken        USDRIF token contract address
     * @param _rifToken           RIF token contract address
     * @param _usdrifPriceFeed    IMoCBaseOracle-compatible feed for USDRIF, or address(0) to start in manual mode
     * @param _rifPriceFeed       IMoCBaseOracle-compatible feed for RIF, or address(0) to start in manual mode
     * @param _manualUsdrifPerRBTC  Fallback rate used only if oracle is off/unset
     * @param _manualRifPerRBTC     Fallback rate used only if oracle is off/unset
     * @param _feeBps             Swap fee in basis points (e.g. 50 = 0.5%)
     * @param _minRBTCOut         Minimum RBTC out per swap (wei)
     * @param _maxRBTCOut         Maximum RBTC out per swap (wei)
     */
    constructor(
        address _usdrifToken,
        address _rifToken,
        address _usdrifPriceFeed,
        address _rifPriceFeed,
        uint256 _manualUsdrifPerRBTC,
        uint256 _manualRifPerRBTC,
        uint256 _feeBps,
        uint256 _minRBTCOut,
        uint256 _maxRBTCOut
    ) {
        require(_usdrifToken != address(0), "GasStation: zero usdrif addr");
        require(_rifToken != address(0), "GasStation: zero rif addr");
        require(_feeBps < 10_000, "GasStation: fee >= 100%");
        require(_minRBTCOut <= _maxRBTCOut, "GasStation: min > max");

        owner = msg.sender;
        usdrifToken = _usdrifToken;
        rifToken = _rifToken;

        if (_usdrifPriceFeed != address(0)) {
            usdrifPriceFeed = IMoCBaseOracle(_usdrifPriceFeed);
            usdrifOracleEnabled = true;
        }
        if (_rifPriceFeed != address(0)) {
            rifPriceFeed = IMoCBaseOracle(_rifPriceFeed);
            rifOracleEnabled = true;
        }

        manualUsdrifPerRBTC = _manualUsdrifPerRBTC;
        manualRifPerRBTC = _manualRifPerRBTC;
        lastUsdrifRate = _manualUsdrifPerRBTC;
        lastRifRate = _manualRifPerRBTC;

        feeBps = _feeBps;
        minRBTCOut = _minRBTCOut;
        maxRBTCOut = _maxRBTCOut;
    }

    // ── Funding ──────────────────────────────────────────────────────────────

    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }

    // ── Core Swap ────────────────────────────────────────────────────────────

    function swapUSDRIFForRBTC(uint256 tokenAmountIn, uint256 minRBTCExpected)
        external
        whenNotPaused
        nonReentrant
    {
        uint256 rate = _resolveRate(usdrifPriceFeed, usdrifOracleEnabled, manualUsdrifPerRBTC, lastUsdrifRate, usdrifToken);
        lastUsdrifRate = rate;
        _swap(usdrifToken, rate, tokenAmountIn, minRBTCExpected);
    }

    function swapRIFForRBTC(uint256 tokenAmountIn, uint256 minRBTCExpected)
        external
        whenNotPaused
        nonReentrant
    {
        uint256 rate = _resolveRate(rifPriceFeed, rifOracleEnabled, manualRifPerRBTC, lastRifRate, rifToken);
        lastRifRate = rate;
        _swap(rifToken, rate, tokenAmountIn, minRBTCExpected);
    }

    // ── Oracle resolution + circuit breaker ─────────────────────────────────

    /// @dev Resolves the current rate for a token, either from its oracle
    /// (with staleness + deviation checks) or the manual fallback if oracle
    /// mode is off. Reverts rather than ever silently swapping at a bad price.
    function _resolveRate(
        IMoCBaseOracle feed,
        bool oracleEnabled,
        uint256 manualRate,
        uint256 lastAcceptedRate,
        address tokenForEvent
    ) internal returns (uint256) {
        if (!oracleEnabled) {
            require(manualRate > 0, "GasStation: manual rate not set");
            return manualRate;
        }

        (bytes32 rawPrice, bool valid) = feed.peek();
        require(valid, "GasStation: oracle price stale/invalid");

        uint256 rate = uint256(rawPrice);
        require(rate > 0, "GasStation: zero oracle rate");

        if (lastAcceptedRate > 0) {
            uint256 diff = rate > lastAcceptedRate ? rate - lastAcceptedRate : lastAcceptedRate - rate;
            uint256 deviationBps = (diff * 10_000) / lastAcceptedRate;
            if (deviationBps > maxDeviationBps) {
                emit CircuitBreakerTripped(tokenForEvent, lastAcceptedRate, rate);
                revert("GasStation: rate moved too much, needs owner review");
            }
        }

        return rate;
    }

    // ── Internal swap math (unchanged from the original) ────────────────────

    function _swap(address token, uint256 rateTokenPerRBTC, uint256 tokenAmountIn, uint256 minRBTCExpected) internal {
        require(tokenAmountIn > 0, "GasStation: zero input");
        require(rateTokenPerRBTC > 0, "GasStation: rate not set");

        uint256 rbtcGross = (tokenAmountIn * 1 ether) / rateTokenPerRBTC;
        uint256 feeRBTC = (rbtcGross * feeBps) / 10_000;
        uint256 rbtcOut = rbtcGross - feeRBTC;

        require(rbtcOut >= minRBTCOut, "GasStation: below min output");
        require(rbtcOut <= maxRBTCOut, "GasStation: above max output");
        require(rbtcOut >= minRBTCExpected, "GasStation: slippage exceeded");
        require(address(this).balance >= rbtcOut, "GasStation: insufficient RBTC reserve");

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), tokenAmountIn);
        require(ok, "GasStation: token transfer failed");

        (bool sent, ) = payable(msg.sender).call{value: rbtcOut}("");
        require(sent, "GasStation: RBTC send failed");

        emit Swapped(msg.sender, token, tokenAmountIn, rbtcOut, feeRBTC);
    }

    // ── View helpers (SAME names/signatures the frontend already calls) ────

    /// @notice Effective current rate for USDRIF — oracle-derived if enabled.
    /// Same external signature as the old public state variable, so the
    /// existing frontend code needs zero changes to keep reading this.
    function usdrifPerRBTC() external view returns (uint256) {
        return usdrifOracleEnabled ? _peekOnly(usdrifPriceFeed) : manualUsdrifPerRBTC;
    }

    /// @notice Effective current rate for RIF — oracle-derived if enabled.
    function rifPerRBTC() external view returns (uint256) {
        return rifOracleEnabled ? _peekOnly(rifPriceFeed) : manualRifPerRBTC;
    }

    function _peekOnly(IMoCBaseOracle feed) internal view returns (uint256) {
        (bytes32 rawPrice, bool valid) = feed.peek();
        require(valid, "GasStation: oracle price stale/invalid");
        return uint256(rawPrice);
    }

    function quoteRBTCOut(address token, uint256 tokenAmountIn) external view returns (uint256 rbtcOut, uint256 feeRBTC) {
        uint256 rate = _rateFor(token);
        require(rate > 0, "GasStation: unsupported token");
        uint256 gross = (tokenAmountIn * 1 ether) / rate;
        feeRBTC = (gross * feeBps) / 10_000;
        rbtcOut = gross - feeRBTC;
    }

    function quoteTokenIn(address token, uint256 rbtcWanted) external view returns (uint256 tokenIn) {
        uint256 rate = _rateFor(token);
        require(rate > 0, "GasStation: unsupported token");
        uint256 grossRBTC = (rbtcWanted * 10_000) / (10_000 - feeBps);
        tokenIn = (grossRBTC * rate) / 1 ether;
    }

    function _rateFor(address token) internal view returns (uint256) {
        if (token == usdrifToken) return usdrifOracleEnabled ? _peekOnly(usdrifPriceFeed) : manualUsdrifPerRBTC;
        if (token == rifToken) return rifOracleEnabled ? _peekOnly(rifPriceFeed) : manualRifPerRBTC;
        return 0;
    }

    function rbtcReserve() external view returns (uint256) {
        return address(this).balance;
    }

    function tokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    // ── Owner Admin ──────────────────────────────────────────────────────────

    function setUSDRIFPriceFeed(address feed) external onlyOwner {
        usdrifPriceFeed = IMoCBaseOracle(feed);
        emit PriceFeedUpdated(usdrifToken, feed);
    }

    function setRIFPriceFeed(address feed) external onlyOwner {
        rifPriceFeed = IMoCBaseOracle(feed);
        emit PriceFeedUpdated(rifToken, feed);
    }

    /// @notice Toggle oracle mode per token. Turning it off falls back to
    /// the manual rate — use only as an emergency measure, and re-check
    /// `manualUsdrifPerRBTC`/`manualRifPerRBTC` are fresh before doing so.
    function setOracleEnabled(address token, bool enabled) external onlyOwner {
        if (token == usdrifToken) {
            usdrifOracleEnabled = enabled;
        } else if (token == rifToken) {
            rifOracleEnabled = enabled;
        } else {
            revert("GasStation: unsupported token");
        }
        emit OracleModeSet(token, enabled);
    }

    /// @notice Emergency/keeper-driven manual rate — only takes effect while
    /// that token's oracle mode is off. Callable by owner OR the priceUpdater
    /// bot, so an automated keeper key never needs owner-level privileges.
    function setUSDRIFRate(uint256 newRate) external onlyOwnerOrUpdater {
        require(newRate > 0, "GasStation: zero rate");
        manualUsdrifPerRBTC = newRate;
        emit RateUpdated(usdrifToken, newRate);
    }

    function setRIFRate(uint256 newRate) external onlyOwnerOrUpdater {
        require(newRate > 0, "GasStation: zero rate");
        manualRifPerRBTC = newRate;
        emit RateUpdated(rifToken, newRate);
    }

    /// @notice Set (or revoke, with address(0)) the automated price-keeper address.
    function setPriceUpdater(address _updater) external onlyOwner {
        emit PriceUpdaterChanged(priceUpdater, _updater);
        priceUpdater = _updater;
    }

    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= 10_000, "GasStation: invalid bps");
        maxDeviationBps = bps;
    }

    /// @notice After a CircuitBreakerTripped event, the owner reviews the
    /// move off-chain and calls this to accept the oracle's current price
    /// as the new baseline, unblocking swaps for that token again.
    function acknowledgeRate(address token) external onlyOwner {
        if (token == usdrifToken) {
            lastUsdrifRate = _peekOnly(usdrifPriceFeed);
            emit RateAcknowledged(token, lastUsdrifRate);
        } else if (token == rifToken) {
            lastRifRate = _peekOnly(rifPriceFeed);
            emit RateAcknowledged(token, lastRifRate);
        } else {
            revert("GasStation: unsupported token");
        }
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

    function withdrawTokens(address token, uint256 amount) external onlyOwner nonReentrant {
        bool ok = IERC20(token).transfer(owner, amount);
        require(ok, "GasStation: withdraw failed");
        emit Withdrawn(token, amount);
    }

    function withdrawRBTC(uint256 amount) external onlyOwner nonReentrant {
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
}
