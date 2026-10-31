import { ethers, network } from "hardhat";

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

  // ── Oracle feeds ───────────────────────────────────────────────────────
  // Set these to the real, verified IMoCBaseOracle-compatible feed addresses
  // for the network you're deploying to (check current addresses against
  // official Money On Chain / RedStone RSK docs before mainnet — do NOT
  // guess an address). Leave as ethers.ZeroAddress to start a token in
  // manual-rate mode instead (useful on testnet, or if no feed exists yet
  // for that token, e.g. RIF/stRIF pairs that don't have oracle coverage).
  // Confirmed via MoC docs (money-on-chain/price_oracle_interfaces README) — Oct 2026.
  // Re-verify on Blockscout before mainnet deploy; addresses can change between networks.
  const IS_MAINNET = network.name === "rskMainnet"; // adjust to match your hardhat.config network name

  const USDRIF_PRICE_FEED = IS_MAINNET
    ? "0xa5A9874559936B32CDE23591e6E7533d665118F2"   // PriceProviderUsdRifUsd — mainnet
    : "0x6Ca13A1050Dddcc507D615Fd2306F591834D7Cdc";  // PriceProviderUsdRifUsd — testnet

  // No confirmed on-chain RIF/USD feed was found from MoC — only USDRIF/USD exists
  // in their published docs. Leaving this in manual mode rather than wiring a feed
  // that doesn't actually price RIF. Two real options, pick one before mainnet:
  //   (a) if rifToken is actually meant to BE USDRIF, deploy with the same
  //       USDRIF_PRICE_FEED address for both legs, or
  //   (b) keep RIF in manual mode and say so plainly in the demo — "RIF rate uses
  //       a manually-configured fallback; USDRIF rate is fully on-chain via MoC."
  // Do not wire a BTC/USD feed here and call it "the RIF price" — it isn't.
  const RIF_PRICE_FEED = ethers.ZeroAddress;

  // Manual fallback rates — used only while the corresponding oracle is disabled.
  const MANUAL_USDRIF_PER_RBTC = 3000n * 10n ** 18n;
  const MANUAL_RIF_PER_RBTC    = 1500n * 10n ** 18n;

  const FEE_BPS         = 50;
  const MIN_RBTC_OUT    = ethers.parseEther("0.00001");
  const MAX_RBTC_OUT    = ethers.parseEther("0.0001");
  const SEED            = ethers.parseEther("0.0001");

  const Factory    = await ethers.getContractFactory("RBTCGasStation");

  // Step 1 — Deploy (no value here)
  const gasStation = await Factory.deploy(
    USDRIF_ADDRESS,
    RIF_ADDRESS,
    USDRIF_PRICE_FEED,
    RIF_PRICE_FEED,
    MANUAL_USDRIF_PER_RBTC,
    MANUAL_RIF_PER_RBTC,
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