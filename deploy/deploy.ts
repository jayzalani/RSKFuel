import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying from:", deployer.address);
  console.log(
    "Balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "RBTC"
  );

  const USDRIF_ADDRESS  = "0x19f64674d8a5b4e652319f5e239efd3bc969a1fe";
  const RIF_ADDRESS     = "0x19f64674d8a5b4e652319f5e239efd3bc969a1fe";
  const USDRIF_PER_RBTC = 3000n * 10n ** 18n;
  const RIF_PER_RBTC    = 1500n * 10n ** 18n;
  const FEE_BPS         = 50;
  const MIN_RBTC_OUT    = ethers.parseEther("0.00001");
  const MAX_RBTC_OUT    = ethers.parseEther("0.0001");
  const SEED            = ethers.parseEther("0.0001");

  const Factory    = await ethers.getContractFactory("RBTCGasStation");

  // Step 1 — Deploy (no value here)
  const gasStation = await Factory.deploy(
    USDRIF_ADDRESS,
    RIF_ADDRESS,
    USDRIF_PER_RBTC,
    RIF_PER_RBTC,
    FEE_BPS,
    MIN_RBTC_OUT,
    MAX_RBTC_OUT
  );
  await gasStation.waitForDeployment();
  const address = await gasStation.getAddress();
  console.log("✅ Deployed at:", address);

  // Step 2 — Fund the contract with RBTC separately
  const tx = await deployer.sendTransaction({
    to: address,
    value: SEED,
  });
  await tx.wait();
  console.log("✅ Funded with:", ethers.formatEther(SEED), "RBTC");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });