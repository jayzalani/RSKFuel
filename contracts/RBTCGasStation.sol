// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title RBTCGasStation
 * @notice Pre-funded RBTC Gas Station on Rootstock.
 *         Users pay with USDRIF or RIF and receive RBTC instantly.
 *
 *         Two ways to swap:
 *          - swapWithQuote(): executes at a live-rate quote signed by `quoteSigner`
 *            (fees already deducted off-chain). This is what the frontend uses.
 *          - swapUSDRIFForRBTC / swapRIFForRBTC: legacy path priced from the
 *            on-chain oracle / keeper rate.
 *
 * @dev PRICE FEED CONVENTION — READ BEFORE DEPLOYING WITH REAL FUNDS:
 *      Each price feed passed in here MUST return, via peek(), "how many
 *      token-wei the user must pay per 1 RBTC-wei", scaled to 1e18.
 *      For RIF you need a cross-rate adapter (BTC/USD ÷ RIF/USD); a raw
 *      BTC/USD feed would misprice RIF.
 */

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

/// @dev Standard interface used by Money On Chain / most RSK price oracles.
interface IMoCBaseOracle {
    function peek() external view returns (bytes32 price, bool valid);
}

contract RBTCGasStation is ReentrancyGuard, EIP712 {
    // ── State ────────────────────────────────────────────────────────────────

    address public owner;

    address public usdrifToken;
    address public rifToken;

    IMoCBaseOracle public usdrifPriceFeed;
    IMoCBaseOracle public rifPriceFeed;

    uint256 public manualUsdrifPerRBTC;
    uint256 public manualRifPerRBTC;

    bool public usdrifOracleEnabled;
    bool public rifOracleEnabled;

    uint256 public maxDeviationBps = 1000; // 10%

    uint256 public lastUsdrifRate;
    uint256 public lastRifRate;

    uint256 public feeBps;
    uint256 public minRBTCOut;
    uint256 public maxRBTCOut;

    bool public paused;

    address public priceUpdater;

    // ── Signed-quote state ───────────────────────────────────────────────────

    struct Quote {
        address token;
        uint256 tokenAmountIn;
        uint256 rbtcOut; // exactly what the user receives (fees already deducted off-chain)
        uint256 deadline;
        bytes32 nonce;
    }

    bytes32 private constant QUOTE_TYPEHASH = keccak256(
        "Quote(address user,address token,uint256 tokenAmountIn,uint256 rbtcOut,uint256 deadline,bytes32 nonce)"
    );

    address public quoteSigner;
    /// @notice A signed quote may pay out at most this much more than the on-chain
    /// reference rate implies. Caps the damage if the signer key is compromised.
    uint256 public maxQuoteDeviationBps = 500; // 5%
    mapping(bytes32 => bool) public usedQuoteNonces;

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
    event QuoteSignerUpdated(address indexed signer);

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
    ) EIP712("RBTCGasStation", "1") {
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

    // ── Core Swap (legacy, on-chain-rate path) ───────────────────────────────

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

    // ── Signed live-rate quotes ──────────────────────────────────────────────

    function swapWithQuote(Quote calldata q, bytes calldata sig) external whenNotPaused nonReentrant {
        _verifyQuote(q, sig);
        _executeQuote(q);
    }

    function _verifyQuote(Quote calldata q, bytes calldata sig) internal {
        require(quoteSigner != address(0), "GasStation: quotes disabled");
        require(block.timestamp <= q.deadline, "GasStation: quote expired");
        require(!usedQuoteNonces[q.nonce], "GasStation: quote already used");
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(QUOTE_TYPEHASH, msg.sender, q.token, q.tokenAmountIn, q.rbtcOut, q.deadline, q.nonce))
        );
        require(ECDSA.recover(digest, sig) == quoteSigner, "GasStation: bad quote signature");
        usedQuoteNonces[q.nonce] = true;
    }

    function _executeQuote(Quote calldata q) internal {
        require(q.tokenAmountIn > 0, "GasStation: zero input");
        uint256 rate = _rateFor(q.token); // 0 for unsupported tokens
        require(rate > 0, "GasStation: unsupported token");

        // Sanity band against the on-chain reference rate (keeper/oracle must stay fresh).
        uint256 refOut = (q.tokenAmountIn * 1 ether) / rate;
        require(
            q.rbtcOut <= (refOut * (10_000 + maxQuoteDeviationBps)) / 10_000,
            "GasStation: quote outside on-chain rate band"
        );

        require(q.rbtcOut >= minRBTCOut, "GasStation: below min output");
        require(q.rbtcOut <= maxRBTCOut, "GasStation: above max output");
        require(address(this).balance >= q.rbtcOut, "GasStation: insufficient RBTC reserve");

        bool ok = IERC20(q.token).transferFrom(msg.sender, address(this), q.tokenAmountIn);
        require(ok, "GasStation: token transfer failed");

        (bool sent, ) = payable(msg.sender).call{value: q.rbtcOut}("");
        require(sent, "GasStation: RBTC send failed");

        emit Swapped(msg.sender, q.token, q.tokenAmountIn, q.rbtcOut, refOut > q.rbtcOut ? refOut - q.rbtcOut : 0);
    }

    // ── Oracle resolution + circuit breaker ─────────────────────────────────

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

    // ── Internal swap math (legacy path) ────────────────────────────────────

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

    // ── View helpers ────────────────────────────────────────────────────────

    function usdrifPerRBTC() external view returns (uint256) {
        return usdrifOracleEnabled ? _peekOnly(usdrifPriceFeed) : manualUsdrifPerRBTC;
    }

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

    function setQuoteSigner(address signer) external onlyOwner {
        quoteSigner = signer;
        emit QuoteSignerUpdated(signer);
    }

    function setMaxQuoteDeviationBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= 2_000, "GasStation: invalid bps");
        maxQuoteDeviationBps = bps;
    }

    function setUSDRIFPriceFeed(address feed) external onlyOwner {
        usdrifPriceFeed = IMoCBaseOracle(feed);
        emit PriceFeedUpdated(usdrifToken, feed);
    }

    function setRIFPriceFeed(address feed) external onlyOwner {
        rifPriceFeed = IMoCBaseOracle(feed);
        emit PriceFeedUpdated(rifToken, feed);
    }

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

    function setPriceUpdater(address _updater) external onlyOwner {
        emit PriceUpdaterChanged(priceUpdater, _updater);
        priceUpdater = _updater;
    }

    function setMaxDeviationBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= 10_000, "GasStation: invalid bps");
        maxDeviationBps = bps;
    }

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
