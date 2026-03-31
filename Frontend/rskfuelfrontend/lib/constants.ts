export const GAS_STATION_ADDRESS = (process.env.NEXT_PUBLIC_GAS_STATION_ADDRESS ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;

export const RSK_TESTNET = {
  chainId: 31,
  chainIdHex: "0x1F",
  name: "RSK Testnet",
  rpcUrl: "https://public-node.testnet.rsk.co",
  explorerUrl: "https://rootstock-testnet.blockscout.com",
  nativeCurrency: { name: "RBTC", symbol: "RBTC", decimals: 18 },
};

export const TOKEN_ADDRESSES = {
  USDRIF: (process.env.NEXT_PUBLIC_USDRIF_ADDRESS ?? "0x19f64674d8a5b4e652319f5e239efd3bc969a1fe") as `0x${string}`,
  RIF:    (process.env.NEXT_PUBLIC_RIF_ADDRESS    ?? "0x19f64674d8a5b4e652319f5e239efd3bc969a1fe") as `0x${string}`,
};

export const TOKENS = [
  { symbol: "USDRIF" as const, label: "USDRIF", address: TOKEN_ADDRESSES.USDRIF },
  { symbol: "RIF"    as const, label: "RIF",    address: TOKEN_ADDRESSES.RIF    },
];

export const DEFAULT_SLIPPAGE_BPS = BigInt(50); // 0.5%
export type TokenSymbol = "USDRIF" | "RIF";
