import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider("https://public-node.testnet.rsk.co");
  const signer   = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY!, provider);

  const artifact = require("../artifacts/contracts/MockERC20.sol/MockERC20.json");
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);

  const usdrif = await factory.deploy("USDRIF", "USDRIF");
  await usdrif.waitForDeployment();
  console.log("✅ USDRIF deployed at:", await usdrif.getAddress());

  const rif = await factory.deploy("RIF", "RIF");
  await rif.waitForDeployment();
  console.log("✅ RIF deployed at:", await rif.getAddress());
}

main().then(() => process.exit(0)).catch(console.error);