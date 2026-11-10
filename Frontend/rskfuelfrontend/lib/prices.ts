/**
 * Server-only live price source shared by /api/live-price (display) and
 * /api/quote (signed swap quotes). One cached upstream call serves both.
 */
const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,rif-token&vs_currencies=usd";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const CACHE_TTL_MS = 10_000;

export type Prices = {
  btcUsd: number; // RBTC == BTC (1:1 peg)
  rifUsd: number;
  updatedAt: number; // when we last got a GOOD response from upstream
  stale: boolean; // true if we are serving the last good value after an upstream failure
};

let cache: { data: Prices; fetchedAt: number } | null = null;

export async function getPrices(): Promise<Prices> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.data;

  try {
    const res = await fetch(COINGECKO_URL, {
      headers: COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {},
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);

    const raw = await res.json();
    const btcUsd = raw.bitcoin?.usd;
    const rifUsd = raw["rif-token"]?.usd;
    if (!(btcUsd > 0) || !(rifUsd > 0)) throw new Error("Malformed CoinGecko response");

    const data: Prices = { btcUsd, rifUsd, updatedAt: Date.now(), stale: false };
    cache = { data, fetchedAt: Date.now() };
    return data;
  } catch (err) {
    console.error("getPrices error:", err);
    if (cache) return { ...cache.data, stale: true }; // caller decides if it is too old
    throw err;
  }
}