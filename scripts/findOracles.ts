import { ethers } from "ethers";

// MoC's main testnet contract — from docs.moneyonchain.com's testnet integration docs.
// VERIFY this address yourself on https://rootstock-testnet.blockscout.com before trusting it.
const MOC_STATE_TESTNET = "0x0adb40132cB0ffcEf6ED81382003f27D25c5157";

const ABI = ["function getBtcPriceProvider() external view returns (address)"];

async function main() {
  const provider = new ethers.JsonRpcProvider("https://public-node.testnet.rsk.co");
  const mocState = new ethers.Contract(MOC_STATE_TESTNET, ABI, provider);
  const btcFeed = await mocState.getBtcPriceProvider();
  console.log("BTC/USD feed (testnet):", btcFeed);
}
main().catch(console.error);