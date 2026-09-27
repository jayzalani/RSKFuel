// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal test double for IMoCBaseOracle. Lets tests/local deploys
/// simulate live price updates, staleness, and circuit-breaker scenarios
/// without depending on a real oracle network. NOT for mainnet use.
contract MockPriceOracle {
    uint256 public price;
    bool public valid = true;
    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "MockPriceOracle: not owner");
        _;
    }

    constructor(uint256 _initialPrice) {
        price = _initialPrice;
        owner = msg.sender;
    }

    /// @notice Simulate a new price tick (token-wei per 1 RBTC-wei, 1e18 scaled).
    function setPrice(uint256 _price) external onlyOwner {
        price = _price;
    }

    /// @notice Simulate the oracle going stale/unreliable.
    function setValid(bool _valid) external onlyOwner {
        valid = _valid;
    }

    function peek() external view returns (bytes32, bool) {
        return (bytes32(price), valid);
    }
}
