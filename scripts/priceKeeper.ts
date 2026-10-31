/**
 * priceKeeper.ts — fetches live market prices and pushes them on-chain as
 * the manual fallback rate. This is your "any API" live-pricing path.
 *
 * DESIGN NOTE: this runs as a single fetch → check → push → exit cycle,
 * not an infinite loop. That's deliberate — schedule it externally (cron,
 * Vercel Cron, GitHub Actions scheduled workflow, a Railway/Render cron
 * job, etc.) to run every 2-5 minutes. A single-shot script restarted by
 * an external scheduler is far more robust than a long-running Node
 * process you have to babysit (no memory leaks, no "it silently died
 * three days ago" surprises).
 *
 * PRICE SOURCE: CoinGecko's free public API.
 *   - RBTC/USD: RSK's two-way peg means RBTC == BTC 1:1, so BTC/USD from
 *     CoinGecko's "bitcoin" id IS the RBTC/USD price. No separate RBTC
 *     feed needed.
 *   - RIF/USD: CoinGecko id "rif-token".
 *   - USDRIF: treated as ~$1 (it's a USD-pegged stablecoin), so
 *     usdrifPerRBTC ≈ btcUsd directly. If you want to track USDRIF's
 *     actual peg instead of assuming exactly $1, find its own CoinGecko
 *     id and fetch it the same way as RIF below.
 *
 * SAFETY: before pushing, this compares the new rate against whatever
 * rate is CURRENTLY on-chain and refuses to push if it moved further than
 * MAX_DEVIATION_PCT — mirroring the contract's own on-chain circuit
 * breaker, but as a second, independent layer of defense against a bad
 * API response ever reaching the chain at all.
 *
 * SETUP:
 *   1. npm install ethers dotenv (if not already present)
 *   2. Set these env vars (e.g. in a .env file, NOT committed):
 *        RSK_RPC_URL=<your mainnet or testnet RPC>
 *        GAS_STATION_ADDRESS=<deployed RBTCGasStation address>
 *        PRICE_UPDATER_PRIVATE_KEY=<key for the priceUpdater role — NOT the owner key>
 *   3. On-chain, once: call station.setPriceUpdater(<address of that key>)
 *      from the owner wallet, so this key is actually authorized.
 *   4. Run once manually to confirm: npx ts-node scripts/priceKeeper.ts
 *   5. Schedule it to run every 2-5 minutes via your platform of choice.
 */

import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const RSK_RPC_URL = process.env.RSK_RPC_URL!;
const GAS_STATION_ADDRESS = process.env.GAS_STATION_ADDRESS!;
const PRICE_UPDATER_PRIVATE_KEY = process.env.PRICE_UPDATER_PRIVATE_KEY!;

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,rif-token&vs_currencies=usd";
// Free Demo key from coingecko.com/en/developers/dashboard — no credit card,
// 30 calls/min, 10,000/month. Optional but strongly recommended: the fully
// keyless tier throttles unpredictably (5-15 req/min with no guarantees).
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY; // may be undefined

// Refuse to push a rate that moved more than this vs. what's currently
// on-chain — catches API glitches, spikes, or a compromised data source.
const MAX_DEVIATION_PCT = 15;

const GAS_STATION_ABI = [
  "function usdrifPerRBTC() external view returns (uint256)",
  "function rifPerRBTC() external view returns (uint256)",
  "function setUSDRIFRate(uint256 newRate) external",
  "function setRIFRate(uint256 newRate) external",
];

interface PriceData {
  bitcoin: { usd: number };
  "rif-token": { usd: number };
}

async function fetchPrices(): Promise<PriceData> {
  const res = await fetch(COINGECKO_URL, {
    headers: COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {},
  });
  if (!res.ok) {
    throw new Error(`CoinGecko request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as PriceData;

  if (!data.bitcoin?.usd || !data["rif-token"]?.usd) {
    throw new Error(`Malformed CoinGecko response: ${JSON.stringify(data)}`);
  }
  if (data.bitcoin.usd <= 0 || data["rif-token"].usd <= 0) {
    throw new Error(`CoinGecko returned a non-positive price: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Percentage difference between two on-chain rates (both 1e18-scaled bigints). */
function pctDiff(oldRate: bigint, newRate: bigint): number {
  if (oldRate === 0n) return 0; // nothing on-chain yet — first push, allow it
  const diff = newRate > oldRate ? newRate - oldRate : oldRate - newRate;
  return Number((diff * 10000n) / oldRate) / 100;
}

// Pass --force on the command line to bypass the deviation guard for a
// one-time initial price seeding (e.g. right after deploying, when the
// on-chain rate is still an arbitrary placeholder, not a real price you
// want to protect). Do NOT make this your normal way of running this —
// it exists for exactly one legitimate use: the very first push after a
// fresh deploy.
const FORCE = process.argv.includes("--force");

async function main() {
  if (!RSK_RPC_URL || !GAS_STATION_ADDRESS || !PRICE_UPDATER_PRIVATE_KEY) {
    throw new Error(
      "Missing required env vars: RSK_RPC_URL, GAS_STATION_ADDRESS, PRICE_UPDATER_PRIVATE_KEY"
    );
  }

  console.log(`[${new Date().toISOString()}] Fetching live prices...`);
  const prices = await fetchPrices();
  const btcUsd = prices.bitcoin.usd;
  const rifUsd = prices["rif-token"].usd;
  console.log(`  BTC/USD (= RBTC/USD): $${btcUsd}`);
  console.log(`  RIF/USD: $${rifUsd}`);

  // usdrifPerRBTC ≈ btcUsd, since USDRIF is a ~$1 stablecoin.
  const newUsdrifRate = ethers.parseUnits(btcUsd.toFixed(8), 18);
  // rifPerRBTC = (USD per RBTC) / (USD per RIF)
  const newRifRate = ethers.parseUnits((btcUsd / rifUsd).toFixed(8), 18);

  const provider = new ethers.JsonRpcProvider(RSK_RPC_URL);
  const updater = new ethers.Wallet(PRICE_UPDATER_PRIVATE_KEY, provider);
  const station = new ethers.Contract(GAS_STATION_ADDRESS, GAS_STATION_ABI, updater);

  const currentUsdrifRate: bigint = await station.usdrifPerRBTC();
  const currentRifRate: bigint = await station.rifPerRBTC();

  const usdrifDeviation = pctDiff(currentUsdrifRate, newUsdrifRate);
  const rifDeviation = pctDiff(currentRifRate, newRifRate);

  let pushedAny = false;
  let nonce = await provider.getTransactionCount(updater.address);

  if (usdrifDeviation > MAX_DEVIATION_PCT && !FORCE) {
    console.warn(
      `⚠️  USDRIF rate moved ${usdrifDeviation.toFixed(2)}% (limit ${MAX_DEVIATION_PCT}%) — SKIPPING push, review manually. (Use --force to override once, e.g. right after a fresh deploy.)`
    );
  } else {
    if (FORCE && usdrifDeviation > MAX_DEVIATION_PCT) {
      console.warn(`⚠️  --force used: pushing USDRIF rate despite a ${usdrifDeviation.toFixed(2)}% move.`);
    }
    const tx = await station.setUSDRIFRate(newUsdrifRate, { nonce: nonce++ });
    await tx.wait();
    console.log(`✅ USDRIF rate updated on-chain (moved ${usdrifDeviation.toFixed(2)}%). tx: ${tx.hash}`);
    pushedAny = true;
  }

  if (rifDeviation > MAX_DEVIATION_PCT && !FORCE) {
    console.warn(
      `⚠️  RIF rate moved ${rifDeviation.toFixed(2)}% (limit ${MAX_DEVIATION_PCT}%) — SKIPPING push, review manually. (Use --force to override once, e.g. right after a fresh deploy.)`
    );
  } else {
    if (FORCE && rifDeviation > MAX_DEVIATION_PCT) {
      console.warn(`⚠️  --force used: pushing RIF rate despite a ${rifDeviation.toFixed(2)}% move.`);
    }
    const tx = await station.setRIFRate(newRifRate, { nonce: nonce++ });
    await tx.wait();
    console.log(`✅ RIF rate updated on-chain (moved ${rifDeviation.toFixed(2)}%). tx: ${tx.hash}`);
    pushedAny = true;
  }

  if (!pushedAny) {
    console.warn("⚠️  No rates were pushed this cycle — both moves exceeded the deviation guard.");
    process.exitCode = 1; // let your scheduler/monitoring flag this run as unusual
  }
}

main().catch((err) => {
  console.error("❌ priceKeeper failed:", err.message ?? err);
  process.exitCode = 1;
});