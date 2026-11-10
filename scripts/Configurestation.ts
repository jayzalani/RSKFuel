/**
 * Run ONCE after deploying: npx ts-node scripts/configureStation.ts
 * Needs in root .env: RSK_TESTNET_RPC_URL, WALLET_PRIVATE_KEY (the OWNER key),
 * GAS_STATION_ADDRESS, QUOTE_SIGNER_ADDRESS (public address of QUOTE_SIGNER_PRIVATE_KEY)
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const ABI = [
  "function setQuoteSigner(address)",
  "function setLimits(uint256,uint256)",
  "function quoteSigner() view returns (address)",
  "function setOracleEnabled(address,bool)",
  "function usdrifToken() view returns (address)",
  "function rifToken() view returns (address)",
];

async function main() {
  const { RSK_TESTNET_RPC_URL, WALLET_PRIVATE_KEY, GAS_STATION_ADDRESS, QUOTE_SIGNER_ADDRESS } = process.env;
  if (!RSK_TESTNET_RPC_URL || !WALLET_PRIVATE_KEY || !GAS_STATION_ADDRESS || !QUOTE_SIGNER_ADDRESS) {
    throw new Error("Missing env: RSK_TESTNET_RPC_URL, WALLET_PRIVATE_KEY, GAS_STATION_ADDRESS, QUOTE_SIGNER_ADDRESS");
  }
  const provider = new ethers.JsonRpcProvider(RSK_TESTNET_RPC_URL);
  const owner = new ethers.Wallet(WALLET_PRIVATE_KEY, provider);
  const station = new ethers.Contract(GAS_STATION_ADDRESS, ABI, owner);

  let nonce = await provider.getTransactionCount(owner.address);

  await (await station.setQuoteSigner(QUOTE_SIGNER_ADDRESS, { nonce: nonce++ })).wait();
  console.log("✅ quoteSigner set to", await station.quoteSigner());

  // min 0.00001 RBTC, max 0.0002 RBTC (covers a $10 swap even if BTC drops to ~$50k)
  await (await station.setLimits(ethers.parseEther("0.00001"), ethers.parseEther("0.0002"), { nonce: nonce++ })).wait();
  console.log("✅ limits set");

  await (await station.setOracleEnabled(await station.usdrifToken(), false, { nonce: nonce++ })).wait();
  await (await station.setOracleEnabled(await station.rifToken(), false, { nonce: nonce++ })).wait();
  console.log("✅ oracle disabled, manual keeper rates active");
}
main().catch((e) => { console.error("❌", e.message ?? e); process.exitCode = 1; });