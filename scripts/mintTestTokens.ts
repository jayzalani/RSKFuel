/**
 * Mints mock USDRIF + RIF to a wallet so you can test swaps.
 * Run: npx ts-node scripts/mintTestTokens.ts
 * Root .env needs: RSK_TESTNET_RPC_URL, WALLET_PRIVATE_KEY,
 *   MOCK_USDRIF_ADDRESS, MOCK_RIF_ADDRESS, and optionally TEST_WALLET_ADDRESS
 *   (defaults to the deployer wallet).
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const { RSK_TESTNET_RPC_URL, WALLET_PRIVATE_KEY, MOCK_USDRIF_ADDRESS, MOCK_RIF_ADDRESS, TEST_WALLET_ADDRESS } = process.env;
  if (!RSK_TESTNET_RPC_URL || !WALLET_PRIVATE_KEY || !MOCK_USDRIF_ADDRESS || !MOCK_RIF_ADDRESS) {
    throw new Error("Missing env: RSK_TESTNET_RPC_URL, WALLET_PRIVATE_KEY, MOCK_USDRIF_ADDRESS, MOCK_RIF_ADDRESS");
  }
  const provider = new ethers.JsonRpcProvider(RSK_TESTNET_RPC_URL);
  const signer = new ethers.Wallet(WALLET_PRIVATE_KEY, provider);
  const to = TEST_WALLET_ADDRESS ?? signer.address;
  let nonce = await provider.getTransactionCount(signer.address);

  for (const [name, addr, amount] of [
    ["USDRIF", MOCK_USDRIF_ADDRESS, "1000"],
    ["RIF", MOCK_RIF_ADDRESS, "100000"],
  ] as const) {
    const t = new ethers.Contract(addr, ["function mint(address,uint256)"], signer);
    await (await t.mint(to, ethers.parseEther(amount), { nonce: nonce++ })).wait();
    console.log(`✅ minted ${amount} ${name} to ${to}`);
  }
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exitCode = 1; });