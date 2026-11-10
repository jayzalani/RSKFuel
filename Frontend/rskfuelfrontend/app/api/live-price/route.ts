import { NextResponse } from "next/server";
import { getPrices } from "../../../lib/prices";

/**
 * GET /api/live-price — DISPLAY prices (RBTC/USD, RIF/USD).
 * Swaps are executed from signed quotes (/api/quote), not from this route.
 */
export async function GET() {
  try {
    const p = await getPrices();
    return NextResponse.json({
      rbtcUsd: p.btcUsd,
      rifUsd: p.rifUsd,
      usdrifPerRBTC: p.btcUsd, // USDRIF assumed $1
      rifPerRBTC: p.btcUsd / p.rifUsd,
      updatedAt: p.updatedAt,
      stale: p.stale,
    });
  } catch {
    return NextResponse.json({ error: "price temporarily unavailable" }, { status: 503 });
  }
}