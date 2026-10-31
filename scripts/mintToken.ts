/**
 * mintTokens.ts — deploys the mock USDRIF/RIF test tokens.
 *
 * Moved here from deploy/mintTokens.ts: hardhat-deploy auto-scans
 * everything in the deploy/ folder and expects each file to export a
 * DeployFunction. This is a plain utility script, not shaped that way,
 * so leaving it in deploy/ made `npx hardhat node` (and `npx hardhat
 * deploy`) crash the same way deploy.ts did.
 *
 * Run: npx ts-node scripts/mintTokens.ts
 * (reads RSK_TESTNET_RPC_URL and WALLET_PRIVATE_KEY from your root .env,
 * same variables hardhat.config.ts already uses — no more hardcoded URL.)
 */

import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL = process.env.RSK_TESTNET_RPC_URL;
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

async function main() {
  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error("Missing RSK_TESTNET_RPC_URL or WALLET_PRIVATE_KEY in your .env");
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  const artifact = require("../artifacts/contracts/MockERC20.sol/MockERC20.json");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

  // Explicit nonce tracking — sequential deploys from the same wallet
  // without this have caused "nonce too low" failures repeatedly elsewhere
  // in this project.
  let nonce = await provider.getTransactionCount(signer.address);

  const usdrif = await factory.deploy("USDRIF", "USDRIF", { nonce: nonce++ });
  await usdrif.waitForDeployment();
  console.log("✅ USDRIF deployed at:", await usdrif.getAddress());

  const rif = await factory.deploy("RIF", "RIF", { nonce: nonce++ });
  await rif.waitForDeployment();
  console.log("✅ RIF deployed at:", await rif.getAddress());
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });