/**
 * deployLocal.ts — standalone local deployment for testing priceKeeper.ts.
 *
 * Deliberately does NOT use `import { ethers } from "hardhat"` — this
 * project also has hardhat-deploy installed, and mixing the two can break
 * TypeScript's module augmentation for hardhat's injected `ethers`. This
 * script instead uses the plain `ethers` package directly (same as
 * priceKeeper.ts) and reads the compiled contract artifacts straight off
 * disk, so it has zero dependency on the Hardhat runtime environment or
 * hardhat-deploy's task system.
 *
 * Run, in order:
 *   1. npx hardhat compile              (generates artifacts/ with ABI + bytecode)
 *   2. npx hardhat node --no-deploy     (starts a local chain; --no-deploy
 *                                        skips hardhat-deploy auto-running
 *                                        deploy/deploy.ts, which isn't
 *                                        shaped for hardhat-deploy yet)
 *   3. npx ts-node scripts/deployLocal.ts
 */

import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = "http://127.0.0.1:8545";

// Hardhat's standard built-in test mnemonic ("test test test ... junk")
// always derives these same local accounts #0 and #1. These are copied
// EXACTLY from this project's own `npx hardhat node` output — always
// prefer what YOUR terminal printed over any hardcoded value (including
// this one), since a single mistyped hex character makes ethers reject
// the key outright.
const DEPLOYER_KEY =
  process.env.LOCAL_DEPLOYER_KEY ??
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PRICE_UPDATER_KEY =
  process.env.LOCAL_PRICE_UPDATER_KEY ??
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function loadArtifact(sourceFile: string, contractName: string) {
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    sourceFile,
    `${contractName}.json`
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found at ${artifactPath} — did you run 'npx hardhat compile' first?`
    );
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

async function main() {
  for (const [name, key] of [
    ["DEPLOYER_KEY", DEPLOYER_KEY],
    ["PRICE_UPDATER_KEY", PRICE_UPDATER_KEY],
  ] as const) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error(
        `${name} is not a valid 32-byte private key (got ${key.length} chars). ` +
          `Copy it again, exactly, from your 'npx hardhat node' terminal output.`
      );
    }
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_KEY, provider);
  const priceUpdater = new ethers.Wallet(PRICE_UPDATER_KEY, provider);

  // Confirm we can actually reach the local node before doing anything else.
  try {
    await provider.getBlockNumber();
  } catch {
    throw new Error(
      `Could not reach ${RPC_URL} — is 'npx hardhat node --no-deploy' running in another terminal?`
    );
  }

  console.log("Deploying mock tokens...");
  let nonce = await provider.getTransactionCount(deployer.address);

  const mockErc20Artifact = loadArtifact("MockERC20.sol", "MockERC20");
  const MockERC20 = new ethers.ContractFactory(mockErc20Artifact.abi, mockErc20Artifact.bytecode, deployer);

  const usdrif = await MockERC20.deploy("Mock USDRIF", "mUSDRIF", { nonce: nonce++ });
  await usdrif.waitForDeployment();

  const rif = await MockERC20.deploy("Mock RIF", "mRIF", { nonce: nonce++ });
  await rif.waitForDeployment();

  console.log("Deploying RBTCGasStation (manual mode — no oracle feeds set)...");
  const stationArtifact = loadArtifact("RBTCGasStation.sol", "RBTCGasStation");
  const Factory = new ethers.ContractFactory(stationArtifact.abi, stationArtifact.bytecode, deployer);

  const station = await Factory.deploy(
    await usdrif.getAddress(),
    await rif.getAddress(),
    ethers.ZeroAddress, // no USDRIF oracle — manual mode
    ethers.ZeroAddress, // no RIF oracle — manual mode
    ethers.parseEther("3000"), // placeholder starting rate, priceKeeper will overwrite this
    ethers.parseEther("1500"),
    50,
    ethers.parseEther("0.00001"),
    ethers.parseEther("1"),
    { nonce: nonce++ }
  );
  await station.waitForDeployment();
  const stationAddress = await station.getAddress();

  console.log("Setting priceUpdater to the second local test account...");
  const tx = await (station as any).connect(deployer).setPriceUpdater(priceUpdater.address, { nonce: nonce++ });
  await tx.wait();

  console.log("\n─────────────────────────────────────────────");
  console.log("Copy these into your .env for testing priceKeeper.ts:\n");
  console.log(`RSK_RPC_URL=${RPC_URL}`);
  console.log(`GAS_STATION_ADDRESS=${stationAddress}`);
  console.log(`PRICE_UPDATER_PRIVATE_KEY=${PRICE_UPDATER_KEY}`);
  console.log("─────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error("❌", err.message ?? err);
  process.exitCode = 1;
});