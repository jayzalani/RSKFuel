"use client";
import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { RBTC_GAS_STATION_ABI, ERC20_ABI } from "@/lib/abi";
import { SWAP_WITH_QUOTE_ABI } from "@/lib/abi.additions";
import { GAS_STATION_ADDRESS } from "@/lib/constants";
import { explorerTx } from "@/lib/utils";
import type { Quote } from "@/hooks/useQuote";

export type SwapStep = "idle" | "approving" | "swapping" | "success" | "error";

export function useSwap() {
  const [step, setStep]     = useState<SwapStep>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);

  const reset = useCallback(() => { setStep("idle"); setTxHash(null); setError(null); }, []);

  const swap = useCallback(async (params: {
    tokenAddress: string;
    quote: Quote;
    signer: ethers.JsonRpcSigner;
  }) => {
    setError(null); setTxHash(null);
    try {
      const { tokenAddress, quote, signer } = params;
      if (!quote.signature || !quote.nonce || !quote.deadline) {
        throw new Error("No signed quote — connect your wallet and try again");
      }
      const tokenAmountIn = BigInt(quote.tokenAmountIn);
      const user = await signer.getAddress();

      // Sponsor gas if the user has no RBTC
      const rbtcBalance = await signer.provider!.getBalance(user);
      if (rbtcBalance < ethers.parseEther("0.000004")) {
        setStep("approving");
        const res  = await fetch("/api/sponsor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userAddress: user }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error ?? "Gas sponsorship failed — try again");
      }

      const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
      const allowed: bigint = await token.allowance(user, GAS_STATION_ADDRESS);
      if (allowed < tokenAmountIn) {
        setStep("approving");
        await (await token.approve(GAS_STATION_ADDRESS, tokenAmountIn)).wait();
      }

      // Approval/sponsorship take time — make sure the locked rate is still valid.
      if (quote.deadline * 1000 < Date.now() + 5_000) {
        throw new Error("Your locked rate expired — a fresh one is loading, please confirm again");
      }

      setStep("swapping");
      const gs = new ethers.Contract(GAS_STATION_ADDRESS, [...RBTC_GAS_STATION_ABI, ...SWAP_WITH_QUOTE_ABI], signer);
      const q = {
        token: tokenAddress,
        tokenAmountIn,
        rbtcOut: BigInt(quote.rbtcOut),
        deadline: quote.deadline,
        nonce: quote.nonce,
      };
      await gs.swapWithQuote.staticCall(q, quote.signature); // surfaces the revert reason before spending gas
      const tx = await gs.swapWithQuote(q, quote.signature);
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