"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { RBTC_GAS_STATION_ABI } from "@/lib/abi";
import { ERC20_ABI } from "@/lib/abi"; // or the correct path where ERC20_ABI is exported
import { GAS_STATION_ADDRESS, RSK_TESTNET } from "@/lib/constants";

const rpc = () => new ethers.JsonRpcProvider(RSK_TESTNET.rpcUrl);

export type ContractState = {
  rbtcReserve: bigint; usdrifPerRBTC: bigint; rifPerRBTC: bigint;
  feeBps: bigint; minRBTCOut: bigint; maxRBTCOut: bigint;
  paused: boolean; isLoading: boolean; refresh: () => void;
};

export function useContractState(): ContractState {
  const [s, setS] = useState({ rbtcReserve: 0n, usdrifPerRBTC: 0n, rifPerRBTC: 0n, feeBps: 0n, minRBTCOut: 0n, maxRBTCOut: 0n, paused: false, isLoading: true });

  const fetch = useCallback(async () => {
    try {
      const c = new ethers.Contract(GAS_STATION_ADDRESS, RBTC_GAS_STATION_ABI, rpc());
      const [reserve, uRate, rRate, fee, minO, maxO, paused] = await Promise.all([
        c.rbtcReserve(), c.usdrifPerRBTC(), c.rifPerRBTC(), c.feeBps(), c.minRBTCOut(), c.maxRBTCOut(), c.paused(),
      ]);
      setS({ rbtcReserve: reserve, usdrifPerRBTC: uRate, rifPerRBTC: rRate, feeBps: fee, minRBTCOut: minO, maxRBTCOut: maxO, paused, isLoading: false });
    } catch { setS(p => ({ ...p, isLoading: false })); }
  }, []);

  useEffect(() => { fetch(); const t = setInterval(fetch, 15_000); return () => clearInterval(t); }, [fetch]);
  return { ...s, refresh: fetch };
}

export async function getUserBalance(tokenAddress: string, user: string): Promise<bigint> {
  return new ethers.Contract(tokenAddress, ERC20_ABI, rpc()).balanceOf(user);
}

export async function quoteRBTCOut(tokenAddress: string, amountIn: bigint): Promise<{ rbtcOut: bigint; feeRBTC: bigint }> {
  const [rbtcOut, feeRBTC] = await new ethers.Contract(GAS_STATION_ADDRESS, RBTC_GAS_STATION_ABI, rpc()).quoteRBTCOut(tokenAddress, amountIn);
  return { rbtcOut, feeRBTC };
}
