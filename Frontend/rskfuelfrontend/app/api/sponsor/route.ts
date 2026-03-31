import { ethers } from "ethers";
import { NextRequest, NextResponse } from "next/server";

const GAS_AMOUNT = ethers.parseEther("0.000008"); // enough for 2 txs (approve + swap)
const MIN_BALANCE = ethers.parseEther("0.000004"); // only sponsor if below this

export async function POST(req: NextRequest) {
  try {
    const { userAddress } = await req.json();
    if (!userAddress) return NextResponse.json({ error: "no address" }, { status: 400 });

    const provider = new ethers.JsonRpcProvider("https://public-node.testnet.rsk.co");
    const sponsor  = new ethers.Wallet(process.env.SPONSOR_PRIVATE_KEY!, provider);

    // Check user balance first
    const balance = await provider.getBalance(userAddress);
    if (balance >= MIN_BALANCE) {
      return NextResponse.json({ success: true, message: "already has gas" });
    }

    // Check sponsor has enough
    const sponsorBalance = await provider.getBalance(sponsor.address);
    if (sponsorBalance < GAS_AMOUNT) {
      return NextResponse.json({ error: "sponsor wallet low on funds" }, { status: 503 });
    }

    // Send tiny RBTC to user
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