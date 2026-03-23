# ⛽ RBTCRefuel — Gas Station for Rootstock Users

> **Rootstock Builder Rootcamp — Capstone Project | Mid-Project Review**
> Module 8 — Assignment 3

---

## What is RBTCRefuel?

RBTCRefuel solves a real and frustrating problem for anyone new to the Rootstock network: **you need RBTC to pay gas fees, but you cannot get RBTC without already having gas to make a transaction.**

This is the classic cold-start problem in Web3. If your wallet runs dry or you are onboarding fresh, you are stuck. You might hold USDRIF or RIF tokens but have no way to use them because you cannot afford the gas to move anything.

RBTCRefuel is a gas station contract deployed on Rootstock. A user connects their wallet, pays with USDRIF or RIF, and the contract sends RBTC back to them instantly — in a single transaction. No relayer, no third-party bridge, no manual process. Just connect, pay, receive gas.

---

## Current Implementation Status

### ✅ Completed

- **Smart contract fully written** — `RBTCRefuel.sol` is production-grade Solidity `^0.8.20`
- **Core swap logic** — `refuel()` function handles the full token-in / RBTC-out flow
- **Quote function** — `quoteRefuel()` lets the frontend preview the swap with zero gas cost
- **Fee system** — basis-point fee deducted from output, accumulated in contract for owner withdrawal
- **Slippage protection** — `minRbtcExpected` parameter on every swap call
- **Swap limits** — configurable min and max RBTC per swap to protect the reserve
- **Owner controls** — rate updates, fee updates, limit updates, pause/unpause, reserve withdrawal
- **Two-step ownership transfer** — safe handover without risk of sending to wrong address
- **Reentrancy guard** — manual `uint256` lock following the Checks-Effects-Interactions pattern
- **Custom errors** — gas-efficient EIP-838 typed errors throughout
- **Event logging** — every state change emits a full event for frontend and explorer tracking
- **Mock ERC-20 tokens** — for local and testnet testing without needing real USDRIF/RIF
- **Remix IDE testing** — manual end-to-end flow verified on RSK Testnet

### 🔄 In Progress

- React frontend — wallet connect, live rate display, one-click refuel
- Live price feed integration — Binance API for BTC/USD and RIF/USD rates
- Frontend-to-contract wiring via ethers.js

### 📋 Planned

- Testnet deployment with funded reserve
- Full frontend deployment
- Owner dashboard for rate management

---

## Architecture

The system is split into two layers. The frontend handles display and user experience. The smart contract handles all money movement and enforcement. The two layers are deliberately independent — the frontend can never override what the contract does.

```
┌─────────────────────────────────────────────────────────┐
│                      USER BROWSER                       │
│                                                         │
│   React Frontend                                        │
│   ├── Fetches BTC + RIF price from Binance public API   │
│   ├── Calculates live rate  (1 USDRIF = X RBTC)         │
│   ├── Shows preview: pay Y tokens → receive Z RBTC      │
│   ├── User confirms rate and enters amount              │
│   └── Sends transaction via ethers.js + MetaMask        │
│                                                         │
└────────────────────────┬────────────────────────────────┘
                         │  signed transaction
                         ▼
┌─────────────────────────────────────────────────────────┐
│              ROOTSTOCK NETWORK (Chain ID 31)            │
│                                                         │
│   RBTCRefuel.sol                                        │
│   ├── Validates token (must be USDRIF or RIF)           │
│   ├── Calculates gross RBTC using stored rate           │
│   ├── Deducts fee (basis points)                        │
│   ├── Checks slippage against minRbtcExpected           │
│   ├── Checks swap is within min/max limits              │
│   ├── Checks reserve has enough RBTC                    │
│   ├── Pulls tokens from user (transferFrom)             │
│   └── Sends net RBTC to user  (call{value})             │
│                                                         │
│   Reserve: RBTC held inside contract (owner-funded)     │
│   Fees:    USDRIF + RIF accumulate, owner withdraws     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Smart Contract Deep Dive

### File

```
contracts/RBTCRefuel.sol
```

### Supported Tokens

| Token  | Role | Notes |
|--------|------|-------|
| USDRIF | Payment token | Pegged 1:1 to USD, native to Rootstock |
| RIF    | Payment token | RIF Protocol token on Rootstock |
| RBTC   | Output token  | Native gas token, held in contract reserve |

---

### Rate Model

Rates are stored on-chain as **RBTC wei per 1 full token unit (1e18 wei)**.

```
grossRbtc = (tokenAmountWei × rate) / 1e18
feeRbtc   = (grossRbtc × feeBps) / 10000
netRbtc   = grossRbtc − feeRbtc
```

**Example** — BTC at $70,000, RIF at $0.09:

```
rbtcPerUsdRif = 1e18 / 70000          = 14,285,714,285 wei per USDRIF wei
rbtcPerRif    = (0.09 / 70000) × 1e18 =  1,285,714,285 wei per RIF wei
```

The owner updates these rates manually to track the market. On-chain oracle integration via Money on Chain (MoC) is the planned upgrade for production.

---

### The Core Swap Function

```solidity
function refuel(
    address token,           // USDRIF or RIF
    uint256 tokenAmount,     // amount user is paying (wei)
    uint256 minRbtcExpected  // slippage guard — minimum RBTC to accept
) external notPaused nonReentrant
```

**Execution order inside `refuel()`:**

```
1. CHECKS
   ├── token must be USDRIF or RIF
   ├── tokenAmount must be > 0
   ├── calculated netRbtc must be >= minRbtcExpected  (slippage)
   ├── netRbtc must be within [minRbtcOut, maxRbtcOut] (limits)
   └── contract balance must cover netRbtc             (reserve)

2. EFFECTS  (state written before any external call)
   ├── totalRbtcDispensed += netRbtc
   ├── totalSwaps         += 1
   └── pendingFeeUsdRif or pendingFeeRif += tokenFee

3. INTERACTIONS  (external calls last)
   ├── IERC20(token).transferFrom(user → contract)
   └── payable(user).call{value: netRbtc}
```

This strict ordering (Checks → Effects → Interactions) is the primary defense against reentrancy attacks, backed up by the `nonReentrant` modifier as a second layer.

---

### All Contract Functions

| Function | Who can call | Description |
|----------|-------------|-------------|
| `refuel(token, amount, minExpected)` | Anyone | Core swap — pay tokens, receive RBTC |
| `quoteRefuel(token, amount)` | Anyone (view) | Preview swap output, zero gas |
| `rbtcReserve()` | Anyone (view) | Current RBTC held in contract |
| `usdrifBalance()` | Anyone (view) | USDRIF held in contract |
| `rifBalance()` | Anyone (view) | RIF held in contract |
| `getContractState()` | Anyone (view) | Full state snapshot in one call |
| `setRates(usdrifRate, rifRate)` | Owner only | Update exchange rates |
| `setFee(feeBps)` | Owner only | Update swap fee (max 5%) |
| `setLimits(min, max)` | Owner only | Update per-swap RBTC limits |
| `setPaused(bool)` | Owner only | Emergency pause/unpause |
| `withdrawRbtc(amount)` | Owner only | Pull RBTC from reserve |
| `withdrawTokens(token, amount)` | Owner only | Pull collected token fees |
| `transferOwnership(newOwner)` | Owner only | Nominate new owner (step 1) |
| `acceptOwnership()` | Pending owner | Complete ownership transfer (step 2) |
| `cancelOwnershipTransfer()` | Owner only | Cancel pending transfer |
| `receive()` | Anyone | Send RBTC to fund the reserve |

---

### Security Design Choices

**Custom errors over require strings**
Every revert uses a typed custom error (`revert NotOwner()`, `revert SlippageExceeded(...)` etc.). This costs less gas than string-based `require()` and gives the frontend specific error types to decode and show the user a meaningful message.

**Manual reentrancy guard**
Uses a `uint256` flag (`_lock`) set to `2` on entry and back to `1` on exit. A `uint256` is used instead of `bool` to avoid an extra cold SSTORE cost on the unlock step — the same approach used by OpenZeppelin's `ReentrancyGuard`.

**Checks-Effects-Interactions pattern**
All validation runs first. State is updated before any external call. External calls (token pull, RBTC push) happen last. This means even if the reentrancy guard were somehow bypassed, the accounting is already committed correctly.

**Slippage parameter**
The `minRbtcExpected` argument on `refuel()` lets the frontend pass the rate it showed the user. If the owner updates rates between the moment the user sees the quote and the moment the transaction confirms, the contract reverts cleanly instead of silently giving the user less than expected.

**Two-step ownership transfer**
`transferOwnership()` only nominates a new owner. The new address must call `acceptOwnership()` to complete the handover. This prevents permanently losing control of the contract due to a typo or copy-paste error.

**Immutable token addresses**
`USDRIF` and `RIF` are declared `immutable` — set once in the constructor and then fixed forever. The owner cannot swap them out for malicious token addresses after deployment.

**Fee hard cap**
`feeBps` can never exceed `MAX_FEE_BPS = 500` (5%). This is enforced at both `constructor` and `setFee()` call sites. Users can always trust the fee cannot silently become extractive.

---

### Events Emitted

| Event | When |
|-------|------|
| `Refueled(user, tokenIn, tokenAmount, rbtcOut, feeRbtc)` | Every successful swap |
| `RatesUpdated(usdrifRate, rifRate, updatedBy)` | Owner updates rates |
| `FeeUpdated(oldFee, newFee)` | Owner updates fee |
| `LimitsUpdated(min, max)` | Owner updates limits |
| `ReserveFunded(sender, amount)` | RBTC deposited into reserve |
| `RbtcWithdrawn(to, amount)` | Owner withdraws RBTC |
| `TokensWithdrawn(token, to, amount)` | Owner withdraws tokens |
| `PausedStateChanged(paused, changedBy)` | Pause toggled |
| `OwnershipTransferInitiated(current, pending)` | Transfer nominated |
| `OwnershipTransferred(previous, new)` | Transfer completed |

---

## Why This Architecture

**Why is the rate stored on-chain and not fetched from an oracle?**
For a testnet demo, manual rate updates by the owner are sufficient to prove the concept. A live oracle (Money on Chain on Rootstock) is the planned upgrade path once the demo is validated. Adding an oracle now would introduce an external dependency that could break the testnet demo if the oracle feed is unavailable.

**Why is the fee deducted from RBTC output rather than the token input?**
Deducting from the output is simpler and more transparent. The user pays exactly the token amount they approved. The contract keeps a proportional slice of the token amount as the fee equivalent. This avoids needing to transfer two separate token amounts.

**Why does the reserve need manual top-ups?**
The long-term vision is for the fee collected on each swap to sustain the RBTC reserve over time. For the prototype, manual funding by the owner is sufficient. A self-sustaining fee loop is the follow-up proposal once swap volume is proven.

**Why no upgradeable proxy?**
Upgradeability adds complexity and a new attack surface. For a focused demo contract this size, a clean redeployment with the new contract address is safer and simpler. The frontend just points to the new address.

---

## Local Testing Setup

```bash
# 1. Clone the repo
git clone <your-repo-url>
cd rbtc-refuel

# 2. Open Remix IDE
# Go to https://remix.ethereum.org
# Import RBTCRefuel.sol and MockERC20.sol

# 3. Compile with Solidity 0.8.20, optimization 200 runs

# 4. Deploy to RSK Testnet via Injected Provider (MetaMask)
#    Chain ID: 31
#    RPC: https://public-node.testnet.rsk.co
#    Faucet: https://faucet.rsk.co

# 5. Deploy MockERC20 twice (USDRIF and RIF)
# 6. Mint test tokens to your wallet
# 7. Deploy RBTCRefuel with mock token addresses
# 8. Fund reserve via the VALUE field in Remix Deploy panel
# 9. Test quoteRefuel → approve → refuel flow
```

---

## Constructor Parameters Reference

| Parameter | Type | Example Value | Description |
|-----------|------|---------------|-------------|
| `_usdrif` | address | MockUSDRIF address | USDRIF token contract |
| `_rif` | address | MockRIF address | RIF token contract |
| `_rbtcPerUsdRif` | uint256 | `14285714285714` | RBTC wei per USDRIF wei |
| `_rbtcPerRif` | uint256 | `1285714285714` | RBTC wei per RIF wei |
| `_feeBps` | uint256 | `50` | 0.5% fee |
| `_minRbtcOut` | uint256 | `1000000000000` | 0.000001 RBTC minimum |
| `_maxRbtcOut` | uint256 | `10000000000000000` | 0.01 RBTC maximum |

---

## Project Structure

```
rbtc-refuel/
├── contracts/
│   ├── RBTCRefuel.sol       # Main gas station contract
│   └── MockERC20.sol        # Test token for local/testnet use
├── frontend/                # React app (in progress)
│   ├── src/
│   │   ├── App.jsx
│   │   ├── hooks/
│   │   │   └── usePrice.js  # Binance API rate fetcher
│   │   └── config.js        # Contract addresses and ABIs
│   └── package.json
└── README.md
```

---

## Known Limitations (Acknowledged)

| Limitation | Impact | Plan |
|-----------|--------|------|
| Rate set manually by owner | Rate can lag market briefly | Integrate MoC oracle on-chain |
| RBTC reserve needs manual top-ups | Requires ongoing funding | Fee-sustaining loop in v2 |
| Only USDRIF and RIF supported | Limits user base | Cross-chain tokens in follow-up grant |
| No automated tests yet | Manual Remix testing only | Hardhat test suite planned |

---

## License

MIT