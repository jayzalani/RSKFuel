import { ethers, run } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying from: ${deployer.address}`);

  // Testnet Addresses (per Rootstock Dev Portal 2026)
 const RIF_ADDR = "0x19f64674D8a5b4e652319F5e239EFd3bc969a1FE".toLowerCase();
const USDRIF_ADDR = "0x8dbf3223075c3f91590430030a2f4d602370649e".toLowerCase();
  // Rate Examples (RBTC wei per 1 token wei)
  const rateUsdRif = 14285714285n; 
  const rateRif = 1285714285n;
  const feeBps = 50n; // 0.5%
  const minOut = ethers.parseEther("0.0001");
  const maxOut = ethers.parseEther("0.1");

  const RBTCRefuel = await ethers.getContractFactory("RBTCRefuel");
  
  // Deploying and pre-funding with 0.05 RBTC
  const contract = await RBTCRefuel.deploy(
    USDRIF_ADDR,
    RIF_ADDR,
    rateUsdRif,
    rateRif,
    feeBps,
    minOut,
    maxOut,
    { value: ethers.parseUnits("50000", "gwei") } // Sending only 0.00005 tRBTC
);

  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`RBTCRefuel deployed to: ${address}`);

  console.log("Waiting for confirmations...");
  await contract.deploymentTransaction()?.wait(5);

  // Verification on Explorer
  try {
    await run("verify:verify", {
      address: address,
      constructorArguments: [USDRIF_ADDR, RIF_ADDR, rateUsdRif, rateRif, feeBps, minOut, maxOut],
    });
  } catch (error) {
    console.error("Verification error:", error);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});