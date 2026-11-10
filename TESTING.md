# RSKFuel — Testing Guide (Rootstock Testnet)

This guide lets anyone reproduce an end-to-end RSKFuel swap on **Rootstock Testnet (chain ID 31)**: pay with USDRIF or RIF, receive RBTC at a live market rate with a visible fee breakup.

> **Status:** testnet prototype, unaudited. Test tokens are mock ERC-20s. Nothing here uses real funds.

---

## 1. What you are testing

| Component | Location | Role |
|---|---|---|
| `RBTCGasStation` contract | `contracts/RBTCGasStation.sol` | Holds the RBTC reserve. Executes swaps from **signed quotes** (`swapWithQuote`). |
| Quote API | `Frontend/rskfuelfrontend/app/api/quote/route.ts` | Fetches the live price, adds fees, signs the exact payout (EIP-712). |
| Live price API | `Frontend/rskfuelfrontend/app/api/live-price/route.ts` | Display prices: RBTC/USD and RIF/USD. |
| Sponsor API | `Frontend/rskfuelfrontend/app/api/sponsor/route.ts` | One-time gas sponsorship for wallets with no RBTC. |
| Price keeper | `scripts/priceKeeper.ts` | Pushes the on-chain reference rate used as a safety band. |
| Frontend | `Frontend/rskfuelfrontend/` | Next.js app: live prices, fee table, swap flow. |

### How a swap works

```
1. User types an amount            → frontend asks /api/quote
2. Server reads live BTC/RIF price → computes fees → signs the exact RBTC payout
3. UI shows the fee breakup + "rate locked for N seconds"
4. User confirms                   → token approve → swapWithQuote(quote, signature)
5. Contract checks:
     signature is from quoteSigner · quote not expired · nonce unused
     payout ≤ on-chain reference rate + 5% band
     within min/max output · reserve has enough RBTC
6. Contract pulls tokens, sends exactly the quoted RBTC, emits Swapped
```

The user receives exactly the amount shown before confirming.

### Fee model (where the revenue comes from)

```
gross RBTC  = payment value in USD ÷ RBTC/USD price
gas fee     = fixed USD amount (default $0.77) ÷ RBTC/USD price
spread      = gross × 0.5%
user gets   = gross − gas fee − spread
```

The station receives the full token amount and pays out `user gets`. The difference (gas fee + spread) is retained as protocol revenue.

Example, a $10 swap with BTC at $74,313: gross 0.00013457 RBTC, gas fee 0.00001036, spread 0.00000067, **user receives ≈ 0.00012354 RBTC**.

---

## 2. Prerequisites

- Node.js 18+ (tested on Node 22), npm
- Git, and a terminal (Linux, macOS or Windows WSL)
- MetaMask browser extension
- Roughly **0.001 tRBTC** to start (see section 4)

```bash
git clone <your-repo-url>
cd rootstock-hardhat-starterkit
npm install
cd Frontend/rskfuelfrontend && npm install && cd ../..
```

---

## 3. Environment variables

Never commit `.env` files or share private keys. Use **testnet-only wallets**.

### 3.1 Generate the wallets you need

From the repo root:

```bash
node -e "const {Wallet}=require('ethers');const w=Wallet.createRandom();console.log('address:',w.address,'\nprivateKey:',w.privateKey)"
```

Run it once per wallet. You need:

| Wallet | Purpose | Needs tRBTC? |
|---|---|---|
| **Owner** | Deploys and administers the contract, funds the reserve | Yes |
| **Quote signer** | Server key that signs quotes (separate from the owner) | No |
| **Sponsor** (optional) | Pays gas for first-time wallets | Yes, a small amount |
| **Test user** | The MetaMask account you swap with | No (tests sponsorship) or a little |

### 3.2 Root `.env` (repo root)

| Variable | Value / how to get it |
|---|---|
| `RSK_TESTNET_RPC_URL` | `https://public-node.testnet.rsk.co` |
| `RSK_RPC_URL` | Same URL as above (used by `priceKeeper.ts`). Must **not** be `http://127.0.0.1:8545` |
| `WALLET_PRIVATE_KEY` | Private key of the **Owner** wallet |
| `PRICE_UPDATER_PRIVATE_KEY` | For testing, same as `WALLET_PRIVATE_KEY` (the owner may set rates) |
| `GAS_STATION_ADDRESS` | Printed by the deploy script (step 5.4) |
| `QUOTE_SIGNER_ADDRESS` | **Public address** of the Quote-signer wallet |
| `MOCK_USDRIF_ADDRESS` | Printed by `mintToken.ts` (step 5.1) |
| `MOCK_RIF_ADDRESS` | Printed by `mintToken.ts` (step 5.1) |
| `TEST_WALLET_ADDRESS` | Address of your MetaMask test account |
| `COINGECKO_API_KEY` | *(optional)* free Demo key from coingecko.com/en/developers/dashboard |

### 3.3 Frontend `.env` (`Frontend/rskfuelfrontend/.env`)

| Variable | Value / how to get it |
|---|---|
| `NEXT_PUBLIC_GAS_STATION_ADDRESS` | Same contract address as `GAS_STATION_ADDRESS` |
| `NEXT_PUBLIC_USDRIF_ADDRESS` | Mock USDRIF address (from step 5.1) |
| `NEXT_PUBLIC_RIF_ADDRESS` | Mock RIF address (from step 5.1). Must differ from USDRIF |
| `QUOTE_SIGNER_PRIVATE_KEY` | **Private key** of the Quote-signer wallet (its address is `QUOTE_SIGNER_ADDRESS`) |
| `SPONSOR_PRIVATE_KEY` | Private key of the Sponsor wallet (only for the gas-sponsorship test) |
| `RSK_RPC_URL` | `https://public-node.testnet.rsk.co` |
| `COINGECKO_API_KEY` | *(optional)* same key as above |
| `QUOTE_GAS_FEE_USD` | *(optional)* fixed fee in USD, default `0.77` |
| `QUOTE_SPREAD_BPS` | *(optional)* spread in basis points, default `50` (0.5%) |
| `QUOTE_TTL_SECONDS` | *(optional)* quote validity, default `90` |

Restart `npm run dev` after any change to the frontend `.env`. `NEXT_PUBLIC_*` values are read at startup.

> The **owner key must never go in the frontend `.env`.** Only the quote-signer and sponsor keys belong there.

---

## 4. Getting test tRBTC

tRBTC is the free test version of RBTC on Rootstock Testnet. It has no value.

1. Add **Rootstock Testnet** to MetaMask (chainId `31`, RPC `https://public-node.testnet.rsk.co`, symbol `tRBTC`).
2. Use the Rootstock testnet faucet (search "Rootstock faucet", currently `faucet.rootstock.io`) and request funds for the **Owner** wallet.
3. If the faucet is rate-limited, ask in the Rootstock community Discord, or send from another testnet wallet.

Budget: deployment uses a few hundred microRBTC. The reserve needs roughly 0.0003–0.0005 tRBTC for a handful of $5–$10 test swaps.

---

## 5. Step-by-step setup

Run everything from the repo root unless stated.

### 5.1 Deploy mock USDRIF and RIF tokens

```bash
npx ts-node scripts/mintToken.ts
```

Expected output:
```
✅ USDRIF deployed at: 0x...
✅ RIF deployed at: 0x...
```
Save both addresses into `MOCK_USDRIF_ADDRESS` / `MOCK_RIF_ADDRESS` (root `.env`) and `NEXT_PUBLIC_USDRIF_ADDRESS` / `NEXT_PUBLIC_RIF_ADDRESS` (frontend `.env`).

### 5.2 Point the deploy script at those tokens

In `deploy/deploy.ts`, set:
```ts
const USDRIF_ADDRESS = "<mock USDRIF address>";
const RIF_ADDRESS    = "<mock RIF address>";
```

### 5.3 Compile

```bash
npx hardhat compile
```
Expected: `Compiled N Solidity files successfully (evm target: london).`

### 5.4 Deploy the gas station

```bash
npx hardhat run deploy/deploy.ts --network rskTestnet
```
Expected:
```
✅ Deployed at: 0x...        ← this is GAS_STATION_ADDRESS
✅ Funded with: 0.0001 RBTC
```
Put the address in `GAS_STATION_ADDRESS` (root) and `NEXT_PUBLIC_GAS_STATION_ADDRESS` (frontend).

### 5.5 Configure the contract

```bash
npx ts-node scripts/configureStation.ts
```
Expected:
```
✅ quoteSigner set to 0x...
✅ limits set
✅ oracle disabled, manual keeper rates active
```
This registers the quote signer, sets the min/max swap output, and switches both tokens to keeper-supplied reference rates.

### 5.6 Push the first real reference price

```bash
npx ts-node scripts/priceKeeper.ts --force
```
Expected: `✅ USDRIF rate updated on-chain` and `✅ RIF rate updated on-chain`. (`--force` is only for this first push after a fresh deploy.)

Keep the rate fresh while testing, otherwise swaps revert with "quote outside on-chain rate band":

```bash
while true; do npx ts-node scripts/priceKeeper.ts; sleep 120; done
```

### 5.7 Fund the RBTC reserve

In MetaMask (Rootstock Testnet), send **0.0003–0.0005 tRBTC** to `GAS_STATION_ADDRESS`. The contract accepts plain transfers.

### 5.8 Mint test tokens to your wallet

```bash
npx ts-node scripts/mintTestTokens.ts
```
Expected:
```
✅ minted 1000 USDRIF to 0x...
✅ minted 100000 RIF to 0x...
```

### 5.9 Export the ABI to the frontend

```bash
node scripts/exportAbi.js
```
Run this every time `RBTCGasStation.sol` changes.

### 5.10 Start the app

```bash
cd Frontend/rskfuelfrontend
npm run dev
```
Open http://localhost:3000, connect MetaMask on Rootstock Testnet.

---

## 6. Test cases

### 6.1 Happy path (main test)

1. Select **USDRIF**. The balance should read `1000.0000`.
2. Enter **10**.
3. Verify the fee table shows: live RBTC price, market rate, payment value, gas recovery fee, spread, total fees, and "You receive (guaranteed)".
4. Verify the "Rate locked for Ns" countdown, refreshing automatically about every 20 seconds.
5. Click **Confirm swap at locked rate**. MetaMask asks for an **approve**, then the **swap**.
6. Expect the green "Swap confirmed" message with a transaction link.

**Pass criteria**
- RBTC balance increased by the "You receive" amount (minus gas if the wallet paid its own).
- USDRIF balance decreased by exactly 10.
- The reserve in the stats bar decreased by about the same RBTC amount.
- The transaction on the explorer shows a `Swapped` event whose `rbtcAmountOut` equals the quoted amount.

### 6.2 RIF swap

Repeat with **RIF**. The fee table also shows the live RIF/USD price. Enter an amount worth $2–$10 (at about $0.057 per RIF, roughly 100 RIF is $5.7).

### 6.3 Gas sponsorship (wallet with zero RBTC)

1. Set `TEST_WALLET_ADDRESS` to a fresh MetaMask account with **0 tRBTC**, and re-run `mintTestTokens.ts`.
2. Ensure `SPONSOR_PRIVATE_KEY` is set and that wallet holds a small amount of tRBTC.
3. Swap as in 6.1.

Pass: the app sponsors a small amount of gas, then approve and swap succeed. Requesting sponsorship twice for the same address is refused.

### 6.4 Input validation

| Action | Expected |
|---|---|
| Enter an amount worth under $2 | "Minimum swap is $2" |
| Enter an amount worth over $10 | "Maximum swap is $10" |
| Enter more than your balance | "Insufficient balance", swap button disabled |
| Wallet on the wrong network | Button becomes "Switch to RSK Testnet" |
| Wallet not connected | Button shows "Connect Wallet" |

### 6.5 Verifying the protocol earned its fee

After a swap, open the contract on the explorer (`https://rootstock-testnet.blockscout.com/address/<GAS_STATION_ADDRESS>`) → **Read contract**:

- `rbtcReserve()` — RBTC remaining.
- `tokenBalance(<mock USDRIF address>)` — tokens collected from users.

For a 10 USDRIF swap: the station gained 10 USDRIF (≈ $10) and paid out ≈ $9.17 of RBTC, so the retained difference is ≈ $0.83 (gas fee $0.77 + spread $0.05 + rounding).

### 6.6 Safety checks (contract-level)

| Scenario | How to trigger | Expected revert |
|---|---|---|
| Stale on-chain reference rate | Stop the keeper for a long time while the market moves more than 5% | `quote outside on-chain rate band` |
| Reserve too low | Withdraw RBTC, or swap more than the reserve holds | `insufficient RBTC reserve` |
| Output above limit | Lower `maxRBTCOut` with `setLimits`, then swap | `above max output` |
| Expired quote | Call `swapWithQuote` after the deadline | `quote expired` |
| Replayed quote | Submit the same signed quote twice | `quote already used` |
| Wrong signer | Change `quoteSigner` after a quote was issued | `bad quote signature` |
| Paused | Owner calls `setPaused(true)` | `paused` |

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ECONNREFUSED 127.0.0.1:8545` | `RSK_RPC_URL` still points to a local node. Set it to the testnet URL. |
| `GasStation: not authorized` (keeper) | `PRICE_UPDATER_PRIVATE_KEY` is not the owner or a registered updater. Use the owner key, or call `setPriceUpdater`. |
| `execution reverted … require(false)` on a script | Wrong `GAS_STATION_ADDRESS` (for example a leftover local-node address). Use the testnet deployment. |
| Balance shows `0.0000` | Tokens not minted to the connected wallet, or the frontend token addresses differ from the minted ones. Re-check `NEXT_PUBLIC_*_ADDRESS`. |
| `quote outside on-chain rate band` | Keeper rate is stale. Run `priceKeeper.ts` again. |
| `insufficient RBTC reserve` | Send more tRBTC to the contract. |
| `quote signer not configured` | `QUOTE_SIGNER_PRIVATE_KEY` missing from the frontend `.env`. Restart the dev server. |
| `bad quote signature` | `QUOTE_SIGNER_PRIVATE_KEY` does not match the address registered with `setQuoteSigner`. |
| Prices look frozen | RIF comes from CoinGecko's free tier, which refreshes about once a minute. BTC comes from Coinbase in near real time. |
| `Cannot find module './configureStation.ts'` | Run from the repo root: `npx ts-node scripts/configureStation.ts`. |
| Frontend shows old behavior | Re-run `node scripts/exportAbi.js` and restart `npm run dev`. |

---

## 8. Known limitations (testnet prototype)

- Contract is **unaudited**, and there is no automated test suite yet (manual end-to-end testing only).
- Test uses mock USDRIF and RIF; mainnet needs the real token addresses and a fresh deployment.
- USDRIF is assumed to be $1. RIF price comes from a single source (CoinGecko).
- The reference-rate keeper runs from a script, not a production scheduler.
- The sponsorship abuse store is in-memory (development only). Production needs Redis or similar, plus transaction rollback handling.
- The contract is owned by a single wallet. Mainnet plans call for a multisig with a timelock.
- Minimum swap and the fixed gas fee are set for testing. Mainnet values should come from measured gas costs.
- No rate limiting on `/api/quote` yet.

---

## 9. Quick command reference

```bash
npm install                                         # root deps
npx hardhat compile                                 # compile contracts
npx ts-node scripts/mintToken.ts                    # deploy mock USDRIF + RIF
npx hardhat run deploy/deploy.ts --network rskTestnet   # deploy gas station
npx ts-node scripts/configureStation.ts             # set signer, limits, manual-rate mode
npx ts-node scripts/priceKeeper.ts --force          # first reference price
npx ts-node scripts/mintTestTokens.ts               # mint test tokens to your wallet
node scripts/exportAbi.js                           # write ABI into the frontend
cd Frontend/rskfuelfrontend && npm run dev          # start the app
```
