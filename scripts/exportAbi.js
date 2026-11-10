// Run from the repo ROOT after `npx hardhat compile`:  node scripts/exportAbi.js
// Rewrites Frontend/rskfuelfrontend/lib/abi.ts with the fresh contract ABI (keeps ERC20_ABI).
const fs = require("fs");
const path = require("path");

const artifact = path.join(__dirname, "..", "artifacts", "contracts", "RBTCGasStation.sol", "RBTCGasStation.json");
const target = path.join(__dirname, "..", "Frontend", "rskfuelfrontend", "lib", "abi.ts");

const abi = JSON.parse(fs.readFileSync(artifact, "utf8")).abi;
const out =
  "export const RBTC_GAS_STATION_ABI = " + JSON.stringify(abi, null, 2) + " as const;\n\n" +
  "export const ERC20_ABI = [\n" +
  '  "function approve(address spender, uint256 amount) returns (bool)",\n' +
  '  "function allowance(address owner, address spender) view returns (uint256)",\n' +
  '  "function balanceOf(address account) view returns (uint256)",\n' +
  '  "function decimals() view returns (uint8)",\n' +
  "] as const;\n";

fs.writeFileSync(target, out);
console.log("✅ ABI written to", target, "(" + abi.length + " entries)");