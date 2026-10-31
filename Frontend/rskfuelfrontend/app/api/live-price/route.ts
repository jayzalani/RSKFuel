import { NextResponse } from "next/server";

/**
 * GET /api/live-price
 *
 * Returns a fast, always-current market price for display purposes —
 * independent of whatever cadence your on-chain rate (oracle or keeper)
 * updates at. This is what makes the number on screen feel "live" on
 * every page refresh, even between keeper pushes.
 *
 * IMPORTANT: this is a DISPLAY price only. The actual swap still uses
 * the contract's on-chain rate via quoteRBTCOut()/quoteTokenIn(), which
 * is what enforces slippage protection — never execute a swap using a
 * number that came only from this route.
 *
 * Cached briefly server-side so 100 simultaneous page loads only cost
 * you one upstream CoinGecko call, not 100.
 */

const COINGECKO_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,rif-token&vs_currencies=usd";
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY;
const CACHE_TTL_MS = 10_000; // 10s — plenty fresh, keeps you well under rate limits

let cache: { data: any; fetchedAt: number } | null = null;

export async function GET() {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json(cache.data);
    }

    const res = await fetch(COINGECKO_URL, {
      headers: COINGECKO_API_KEY ? { "x-cg-demo-api-key": COINGECKO_API_KEY } : {},
      // Next.js: don't let its own fetch cache serve something stale for longer than we want
      cache: "no-store",
    });

    if (!res.ok) {
      // If CoinGecko is briefly unavailable/rate-limited, serve the last
      // good cached value (even if slightly stale) rather than an error,
      // so the UI never shows "N/A" for a purely cosmetic number.
      if (cache) return NextResponse.json({ ...cache.data, stale: true });
      throw new Error(`CoinGecko request failed: ${res.status}`);
    }

    const raw = await res.json();
    const btcUsd = raw.bitcoin?.usd;
    const rifUsd = raw["rif-token"]?.usd;

    if (!btcUsd || !rifUsd) {
      throw new Error("Malformed CoinGecko response");
    }

    const data = {
      rbtcUsd: btcUsd, // RBTC = BTC, 1:1 peg
      rifUsd,
      usdrifPerRBTC: btcUsd, // USDRIF ≈ $1
      rifPerRBTC: btcUsd / rifUsd,
      updatedAt: Date.now(),
      stale: false,
    };

    cache = { data, fetchedAt: Date.now() };
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("live-price error:", err.message);
    if (cache) return NextResponse.json({ ...cache.data, stale: true });
    return NextResponse.json({ error: "price temporarily unavailable" }, { status: 503 });
  }
}