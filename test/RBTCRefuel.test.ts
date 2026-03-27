import { expect } from "chai";
import { ethers } from "hardhat";
import { RBTCRefuel, MockERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RBTCRefuel Full Suite", function () {
  let refuel: RBTCRefuel;
  let usdrif: MockERC20;
  let rif: MockERC20;
  let owner: SignerWithAddress;
  let user: SignerWithAddress;
  let other: SignerWithAddress;

  // Use smaller limits for testing so realistic rates don't trigger reverts
  const INITIAL_RATE_USDRIF = 14285714285n; 
  const INITIAL_RATE_RIF = 1285714285n;    
  const FEE_BPS = 500n;                    // 5%
  const MIN_OUT = 100n;                    // Very low min (100 wei)
  const MAX_OUT = ethers.parseEther("10"); // High max
  const INITIAL_RESERVE = ethers.parseEther("10");

  beforeEach(async () => {
    [owner, user, other] = await ethers.getSigners();

    const TokenFact = await ethers.getContractFactory("MockERC20");
    usdrif = await TokenFact.deploy("USDRIF", "USDRIF");
    rif = await TokenFact.deploy("RIF", "RIF");

    const RefuelFact = await ethers.getContractFactory("RBTCRefuel");
    refuel = await RefuelFact.deploy(
      await usdrif.getAddress(),
      await rif.getAddress(),
      INITIAL_RATE_USDRIF,
      INITIAL_RATE_RIF,
      FEE_BPS,
      MIN_OUT,
      MAX_OUT,
      { value: INITIAL_RESERVE }
    );

    await usdrif.mint(user.address, ethers.parseEther("1000"));
    await usdrif.connect(user).approve(await refuel.getAddress(), ethers.parseEther("1000"));
    
    await rif.mint(user.address, ethers.parseEther("1000"));
    await rif.connect(user).approve(await refuel.getAddress(), ethers.parseEther("1000"));
  });

  describe("Core Refuel Logic (Swaps)", () => {
    it("Should swap USDRIF for RBTC correctly", async () => {
      const amountIn = ethers.parseEther("100"); // Use 100 tokens to get a larger RBTC output
      const gross = (amountIn * INITIAL_RATE_USDRIF) / ethers.parseUnits("1", 18);
      const fee = (gross * FEE_BPS) / 10000n;
      const expectedNet = gross - fee;

      const userBalBefore = await ethers.provider.getBalance(user.address);
      const tx = await refuel.connect(user).refuel(await usdrif.getAddress(), amountIn, 0);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * receipt!.gasPrice;

      expect(await ethers.provider.getBalance(user.address)).to.equal(userBalBefore + expectedNet - gasCost);
    });

    it("Should track pending fees in tokens", async () => {
      const amountIn = ethers.parseEther("100");
      await refuel.connect(user).refuel(await usdrif.getAddress(), amountIn, 0);
      
      const pending = await refuel.pendingFeeUsdRif();
      expect(pending).to.be.gt(0n);
    });
  });

  describe("Constraints & Safety", () => {
    it("Should revert if swap output is below minimum", async () => {
      // Set MIN_OUT very high to trigger revert
      await refuel.setLimits(ethers.parseEther("1"), ethers.parseEther("2"));
      
      await expect(
        refuel.connect(user).refuel(await usdrif.getAddress(), ethers.parseEther("1"), 0)
      ).to.be.revertedWithCustomError(refuel, "BelowMinimumSwap");
    });

    it("Should revert if swap output is zero (RateQuotesZeroRbtc)", async () => {
      // 1 wei of token * low rate = 0 gross RBTC
      await expect(
        refuel.connect(user).refuel(await usdrif.getAddress(), 1n, 0)
      ).to.be.revertedWithCustomError(refuel, "RateQuotesZeroRbtc");
    });

    it("Should revert if the reserve is dry", async () => {
      // Withdraw reserve
      await refuel.withdrawRbtc(INITIAL_RESERVE); 
      
      // Attempt a swap that is valid by limits but exceeds reserve
      await expect(
        refuel.connect(user).refuel(await usdrif.getAddress(), ethers.parseEther("100"), 0)
      ).to.be.revertedWithCustomError(refuel, "InsufficientRBTCReserve");
    });
  });

  describe("Admin & Ownership", () => {
    it("Should allow owner to withdraw accumulated tokens", async () => {
      const amount = ethers.parseEther("100");
      await refuel.connect(user).refuel(await usdrif.getAddress(), amount, 0);
      
      const ownerBalBefore = await usdrif.balanceOf(owner.address);
      const contractTokenBal = await usdrif.balanceOf(await refuel.getAddress());
      
      await refuel.withdrawTokens(await usdrif.getAddress(), contractTokenBal);
      expect(await usdrif.balanceOf(owner.address)).to.equal(ownerBalBefore + contractTokenBal);
    });
  });
});