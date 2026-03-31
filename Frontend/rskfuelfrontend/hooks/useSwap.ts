"use client";
import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { RBTC_GAS_STATION_ABI, ERC20_ABI } from "@/lib/abi";
import { GAS_STATION_ADDRESS, DEFAULT_SLIPPAGE_BPS, TokenSymbol } from "@/lib/constants";
import { applySlippage, explorerTx } from "@/lib/utils";

export type SwapStep = "idle" | "approving" | "swapping" | "success" | "error";

export function useSwap() {
  const [step, setStep]     = useState<SwapStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const reset = useCallback(() => { setStep("idle"); setTxHash(null); setError(null); }, []);

  const swap = useCallback(async (params: {
  tokenAddress: string; tokenSymbol: TokenSymbol;
  tokenAmountIn: bigint; expectedRBTCOut: bigint;
  signer: ethers.JsonRpcSigner;
}) => {
  setError(null); setTxHash(null);
  try {
    const { tokenAddress, tokenSymbol, tokenAmountIn, expectedRBTCOut, signer } = params;
    const user = await signer.getAddress();

    // ── NEW: sponsor gas if user has no RBTC ──────────────────────
    const provider = signer.provider!;
    const rbtcBalance = await provider.getBalance(user);

    if (rbtcBalance < ethers.parseEther("0.000004")) {
      setStep("approving"); // show loading while sponsoring
      const res  = await fetch("/api/sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: user }),
      });
      const data = await res.json();
      if (!data.success) throw new Error("Gas sponsorship failed — try again");
    }
    // ─────────────────────────────────────────────────────────────

    const token   = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    const allowed: bigint = await token.allowance(user, GAS_STATION_ADDRESS);

    if (allowed < tokenAmountIn) {
      setStep("approving");
      await (await token.approve(GAS_STATION_ADDRESS, tokenAmountIn)).wait();
    }

    setStep("swapping");
    const gs  = new ethers.Contract(GAS_STATION_ADDRESS, RBTC_GAS_STATION_ABI, signer);
    const min = applySlippage(expectedRBTCOut, DEFAULT_SLIPPAGE_BPS);
    const tx  = tokenSymbol === "USDRIF"
      ? await gs.swapUSDRIFForRBTC(tokenAmountIn, min)
      : await gs.swapRIFForRBTC(tokenAmountIn, min);
    const receipt = await tx.wait();
    setTxHash(receipt.hash);
    setStep("success");
  } catch (e: any) {
    setError(e?.reason || e?.shortMessage || e?.message || "Transaction failed");
    setStep("error");
  }
}, []);

  return { step, txHash, txUrl: txHash ? explorerTx(txHash) : null, error, swap, reset };
}
