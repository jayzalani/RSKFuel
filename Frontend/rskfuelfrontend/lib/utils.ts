import { ethers } from "ethers";

export const formatRBTC = (wei: bigint, dp = 6) =>
  parseFloat(ethers.formatEther(wei)).toFixed(dp);

export const formatToken = (wei: bigint, dp = 4) =>
  parseFloat(ethers.formatEther(wei)).toFixed(dp);

export const shortenAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const applySlippage = (amount: bigint, bps: bigint) =>
  (amount * (BigInt(10_000) - bps)) / BigInt(10_000);

export const explorerTx = (hash: string) =>
  `https://rootstock-testnet.blockscout.com/tx/${hash}`;

export const explorerAddr = (addr: string) =>
  `https://rootstock-testnet.blockscout.com/address/${addr}`;

export function parseTokenInput(value: string): bigint {
  try {
    if (!value || isNaN(parseFloat(value))) return BigInt(0);
    return ethers.parseEther(value);
  } catch { return BigInt(0); }
}
