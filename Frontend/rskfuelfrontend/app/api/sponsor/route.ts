import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { sponsorStore, MAX_SPONSORSHIPS_PER_IP } from "@/lib/sponsorStore";
import { TOKEN_ADDRESSES } from "@/lib/constants";
import { ERC20_ABI } from "@/lib/abi";

const GAS_AMOUNT = ethers.parseEther("0.000008"); // enough for 2 txs (approve + swap)
const MIN_BALANCE = ethers.parseEther("0.000004"); // only sponsor if below this

// Proof-of-intent guard: only sponsor addresses that actually hold enough
// USDRIF or RIF to be a real swap attempt, not an empty farmed wallet.
// Tune this to roughly your smallest realistic swap size.
const MIN_TOKEN_BALANCE = ethers.parseUnits("1", 18);

// Read the RPC URL from env so this route follows whatever network you've
// configured elsewhere, instead of being silently pinned to testnet.
const RPC_URL = process.env.RSK_RPC_URL ?? "https://public-node.testnet.rsk.co";

function getClientIp(req: NextRequest): string {
  // Vercel/most proxies set x-forwarded-for as "client, proxy1, proxy2".
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

async function hasRealTokenBalance(provider: ethers.JsonRpcProvider, userAddress: string): Promise<boolean> {
  try {
    const checks = await Promise.all(
      Object.values(TOKEN_ADDRESSES).map(async (tokenAddress) => {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const balance: bigint = await token.balanceOf(userAddress);
        return balance >= MIN_TOKEN_BALANCE;
      })
    );
    return checks.some(Boolean);
  } catch {
    // If the balance check itself fails (bad RPC, etc.), fail closed —
    // don't sponsor if we can't verify intent.
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { userAddress } = await req.json();
    if (!userAddress || !ethers.isAddress(userAddress)) {
      return NextResponse.json({ error: "invalid address" }, { status: 400 });
    }

    const ip = getClientIp(req);

    // ── Guard 1: one sponsorship per address, ever ──────────────────────
    if (await sponsorStore.hasBeenSponsored(userAddress)) {
      return NextResponse.json(
        { error: "This address has already received a gas sponsorship." },
        { status: 429 }
      );
    }

    // ── Guard 2: per-IP rate limit ───────────────────────────────────────
    const ipCount = await sponsorStore.getIpSponsorCount(ip);
    if (ipCount >= MAX_SPONSORSHIPS_PER_IP) {
      return NextResponse.json(
        { error: "Too many sponsorship requests from this network. Try again later." },
        { status: 429 }
      );
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const sponsor = new ethers.Wallet(process.env.SPONSOR_PRIVATE_KEY!, provider);

    // Check user's RBTC balance first — maybe they don't need it anymore.
    const balance = await provider.getBalance(userAddress);
    if (balance >= MIN_BALANCE) {
      return NextResponse.json({ success: true, message: "already has gas" });
    }

    // ── Guard 3: proof of intent — must hold real swap-relevant tokens ──
    if (!(await hasRealTokenBalance(provider, userAddress))) {
      return NextResponse.json(
        { error: "Fund your wallet with USDRIF or RIF first, then request gas sponsorship." },
        { status: 403 }
      );
    }

    // Check sponsor wallet has enough left.
    const sponsorBalance = await provider.getBalance(sponsor.address);
    if (sponsorBalance < GAS_AMOUNT) {
      return NextResponse.json({ error: "sponsor wallet low on funds" }, { status: 503 });
    }

    // Record intent to sponsor BEFORE sending, so a slow/retried request
    // can't slip through the guards twice while the first tx is pending.
    await sponsorStore.markSponsored(userAddress);
    await sponsorStore.recordIpSponsorship(ip);

    const tx = await sponsor.sendTransaction({
      to: userAddress,
      value: GAS_AMOUNT,
    });
    await tx.wait();

    return NextResponse.json({ success: true, txHash: tx.hash });
  } catch (err: any) {
    console.error("Sponsor error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}