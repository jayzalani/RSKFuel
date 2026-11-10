import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { getPrices } from "../../../lib/prices";
import { GAS_STATION_ADDRESS, TOKEN_ADDRESSES, RSK_TESTNET } from "@/lib/constants";

/**
 * POST /api/quote  { token: "USDRIF" | "RIF", amountIn: "5.0", userAddress?: "0x…" }
 *
 * Prices the swap at the LIVE market rate, deducts your fees, and (when a
 * userAddress is supplied) signs the exact payout with EIP-712. The contract's
 * swapWithQuote() verifies that signature and pays exactly `rbtcOut`.
 *
 * Revenue per swap = gasFee (fixed USD, recovers sponsored gas) + spread (bps of value).
 * Both stay with the station: the user pays full token value, receives value minus fees.
 */

const SIGNER_KEY = process.env.QUOTE_SIGNER_PRIVATE_KEY; // server-only; NOT the owner/sponsor key
const SPREAD_BPS = BigInt(process.env.QUOTE_SPREAD_BPS ?? "50"); // 0.5%
const GAS_FEE_USD = process.env.QUOTE_GAS_FEE_USD ?? "0.77"; // set from MEASURED gas cost
const TTL_SECONDS = Number(process.env.QUOTE_TTL_SECONDS ?? "90"); // must cover approve + swap
const MIN_USD = 2;
const MAX_USD = 10;
const MAX_PRICE_AGE_MS = 60_000; // refuse to sign on older prices

const E8 = 100_000_000n;
const BPS = 10_000n;

const QUOTE_TYPES = {
  Quote: [
    { name: "user", type: "address" },
    { name: "token", type: "address" },
    { name: "tokenAmountIn", type: "uint256" },
    { name: "rbtcOut", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export async function POST(req: NextRequest) {
  try {
    const { token, amountIn: amountStr, userAddress } = await req.json();

    if (token !== "USDRIF" && token !== "RIF") {
      return NextResponse.json({ error: "unsupported token" }, { status: 400 });
    }
    let amountIn: bigint;
    try {
      amountIn = ethers.parseUnits(String(amountStr), 18); // both tokens are 18-decimals
    } catch {
      return NextResponse.json({ error: "invalid amount" }, { status: 400 });
    }
    if (amountIn <= 0n) return NextResponse.json({ error: "invalid amount" }, { status: 400 });
    if (userAddress && !ethers.isAddress(userAddress)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }

    // ── Live prices ──────────────────────────────────────────────────────
    const prices = await getPrices();
    if (Date.now() - prices.updatedAt > MAX_PRICE_AGE_MS) {
      return NextResponse.json({ error: "Live price is stale — try again shortly" }, { status: 503 });
    }
    const btc8 = BigInt(Math.round(prices.btcUsd * 1e8));
    const tokenUsd = token === "USDRIF" ? 1 : prices.rifUsd; // USDRIF assumed $1
    const tok8 = BigInt(Math.round(tokenUsd * 1e8));

    // ── Value + fees (all integer math, RBTC in wei) ────────────────────
    const valueUsd18 = (amountIn * tok8) / E8;
    const valueUsd = Number(ethers.formatUnits(valueUsd18, 18));
    if (valueUsd < MIN_USD) return NextResponse.json({ error: `Minimum swap is $${MIN_USD}` }, { status: 400 });
    if (valueUsd > MAX_USD) return NextResponse.json({ error: `Maximum swap is $${MAX_USD}` }, { status: 400 });

    const grossRbtc = (valueUsd18 * E8) / btc8;
    const spreadRbtc = (grossRbtc * SPREAD_BPS) / BPS;
    const gasFeeRbtc = (ethers.parseUnits(GAS_FEE_USD, 18) * E8) / btc8;
    const totalFeeRbtc = spreadRbtc + gasFeeRbtc;
    if (grossRbtc <= totalFeeRbtc) {
      return NextResponse.json({ error: "Amount too small to cover fees" }, { status: 400 });
    }
    const rbtcOut = grossRbtc - totalFeeRbtc;

    // ── Sign (only when we know who the quote is for) ───────────────────
    let signature: string | null = null;
    let nonce: string | null = null;
    let deadline: number | null = null;

    if (userAddress) {
      if (!SIGNER_KEY) return NextResponse.json({ error: "quote signer not configured" }, { status: 500 });
      nonce = ethers.hexlify(ethers.randomBytes(32));
      deadline = Math.floor(Date.now() / 1000) + TTL_SECONDS;
      signature = await new ethers.Wallet(SIGNER_KEY).signTypedData(
        {
          name: "RBTCGasStation",
          version: "1",
          chainId: RSK_TESTNET.chainId,
          verifyingContract: GAS_STATION_ADDRESS,
        },
        QUOTE_TYPES,
        { user: userAddress, token: TOKEN_ADDRESSES[token as "USDRIF" | "RIF"], tokenAmountIn: amountIn, rbtcOut, deadline, nonce }
      );
    }

    return NextResponse.json({
      token,
      tokenAddress: TOKEN_ADDRESSES[token as "USDRIF" | "RIF"],
      tokenAmountIn: amountIn.toString(),
      rbtcOut: rbtcOut.toString(),
      deadline,
      nonce,
      signature,
      fetchedAt: Date.now(),
      rates: { btcUsd: prices.btcUsd, rifUsd: prices.rifUsd, tokenUsd },
      breakdown: {
        valueUsd,
        grossRbtc: grossRbtc.toString(),
        gasFeeUsd: Number(GAS_FEE_USD),
        gasFeeRbtc: gasFeeRbtc.toString(),
        spreadBps: Number(SPREAD_BPS),
        spreadRbtc: spreadRbtc.toString(),
        totalFeeRbtc: totalFeeRbtc.toString(),
        effectiveFeePct: Number((totalFeeRbtc * 1_000_000n) / grossRbtc) / 10_000,
      },
    });
  } catch (err: any) {
    console.error("quote error:", err);
    return NextResponse.json({ error: "could not generate quote" }, { status: 500 });
  }
}