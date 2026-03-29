import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("RBTCGasStation", function () {

  // ── Constants ──────────────────────────────────────────────────────────────
  const USDRIF_PER_RBTC = 3000n * 10n ** 18n;
  const RIF_PER_RBTC    = 1500n * 10n ** 18n;
  const FEE_BPS         = 50n;
  const MIN_RBTC_OUT    = ethers.parseEther("0.00001");  // 0.00001 RBTC
  const MAX_RBTC_OUT    = ethers.parseEther("0.0001");   // 0.0001  RBTC
  const SEED_RBTC       = ethers.parseEther("1");

  // Token amounts that produce RBTC within [MIN, MAX]:
  // 0.0001 RBTC * 3000 USDRIF/RBTC = 0.3 USDRIF → use 0.27 USDRIF (leaves fee headroom)
  // USDRIF: 0.27 * 1e18 → gives ~0.00009 RBTC (within limits)
  // RIF:    0.135 * 1e18 → gives ~0.00009 RBTC (within limits)
  const USDRIF_AMOUNT_IN = ethers.parseEther("0.27");   // → ~0.00009 RBTC out
  const RIF_AMOUNT_IN    = ethers.parseEther("0.135");  // → ~0.00009 RBTC out

  // ── Fixture ────────────────────────────────────────────────────────────────
  async function deployFixture() {
    const [owner, user, other] = await ethers.getSigners();

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const usdrif = await MockERC20.deploy("USDRIF", "USDRIF");
    const rif    = await MockERC20.deploy("RIF", "RIF");

    const Factory = await ethers.getContractFactory("RBTCGasStation");
    const gasStation = await Factory.deploy(
      await usdrif.getAddress(),
      await rif.getAddress(),
      USDRIF_PER_RBTC,
      RIF_PER_RBTC,
      FEE_BPS,
      MIN_RBTC_OUT,
      MAX_RBTC_OUT
    );
    await gasStation.waitForDeployment();

    // Fund contract separately
    await owner.sendTransaction({
      to: await gasStation.getAddress(),
      value: SEED_RBTC,
    });

    // Mint tokens to user
    await usdrif.mint(user.address, 10_000n * 10n ** 18n);
    await rif.mint(user.address,    10_000n * 10n ** 18n);

    return { gasStation, usdrif, rif, owner, user, other };
  }

  // ── 1. Deployment ──────────────────────────────────────────────────────────
  describe("Deployment", function () {

    it("sets the correct owner", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      expect(await gasStation.owner()).to.equal(owner.address);
    });

    it("stores correct USDRIF rate", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      expect(await gasStation.usdrifPerRBTC()).to.equal(USDRIF_PER_RBTC);
    });

    it("stores correct RIF rate", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      expect(await gasStation.rifPerRBTC()).to.equal(RIF_PER_RBTC);
    });

    it("stores correct fee", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      expect(await gasStation.feeBps()).to.equal(FEE_BPS);
    });

    it("stores correct limits", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      expect(await gasStation.minRBTCOut()).to.equal(MIN_RBTC_OUT);
      expect(await gasStation.maxRBTCOut()).to.equal(MAX_RBTC_OUT);
    });

    it("is not paused on deploy", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      expect(await gasStation.paused()).to.equal(false);
    });

    it("RBTC reserve equals seeded amount", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      expect(await gasStation.rbtcReserve()).to.equal(SEED_RBTC);
    });

    it("reverts if minRBTCOut > maxRBTCOut", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdrif = await MockERC20.deploy("USDRIF", "USDRIF");
      const rif    = await MockERC20.deploy("RIF", "RIF");
      const Factory = await ethers.getContractFactory("RBTCGasStation");

      await expect(
        Factory.deploy(
          await usdrif.getAddress(),
          await rif.getAddress(),
          USDRIF_PER_RBTC,
          RIF_PER_RBTC,
          FEE_BPS,
          ethers.parseEther("1"),
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWith("GasStation: min > max");
    });

    it("reverts if fee >= 100%", async function () {
      const MockERC20 = await ethers.getContractFactory("MockERC20");
      const usdrif = await MockERC20.deploy("USDRIF", "USDRIF");
      const rif    = await MockERC20.deploy("RIF", "RIF");
      const Factory = await ethers.getContractFactory("RBTCGasStation");

      await expect(
        Factory.deploy(
          await usdrif.getAddress(),
          await rif.getAddress(),
          USDRIF_PER_RBTC,
          RIF_PER_RBTC,
          10_000,
          MIN_RBTC_OUT,
          MAX_RBTC_OUT
        )
      ).to.be.revertedWith("GasStation: fee >= 100%");
    });
  });

  // ── 2. Funding ─────────────────────────────────────────────────────────────
  describe("Funding", function () {

    it("accepts RBTC via direct send and emits Funded", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      const topUp  = ethers.parseEther("0.5");
      const before = await gasStation.rbtcReserve();

      await expect(
        owner.sendTransaction({ to: await gasStation.getAddress(), value: topUp })
      ).to.emit(gasStation, "Funded").withArgs(owner.address, topUp);

      expect(await gasStation.rbtcReserve()).to.equal(before + topUp);
    });
  });

  // ── 3. quoteRBTCOut ────────────────────────────────────────────────────────
  describe("quoteRBTCOut", function () {

    it("returns correct RBTC out and fee for USDRIF", async function () {
      const { gasStation, usdrif } = await loadFixture(deployFixture);

      const [rbtcOut, feeRBTC] = await gasStation.quoteRBTCOut(
        await usdrif.getAddress(), USDRIF_AMOUNT_IN
      );

      const gross       = (USDRIF_AMOUNT_IN * ethers.parseEther("1")) / USDRIF_PER_RBTC;
      const expectedFee = (gross * FEE_BPS) / 10_000n;
      const expectedOut = gross - expectedFee;

      expect(feeRBTC).to.equal(expectedFee);
      expect(rbtcOut).to.equal(expectedOut);
    });

    it("returns correct RBTC out and fee for RIF", async function () {
      const { gasStation, rif } = await loadFixture(deployFixture);

      const [rbtcOut, feeRBTC] = await gasStation.quoteRBTCOut(
        await rif.getAddress(), RIF_AMOUNT_IN
      );

      const gross       = (RIF_AMOUNT_IN * ethers.parseEther("1")) / RIF_PER_RBTC;
      const expectedFee = (gross * FEE_BPS) / 10_000n;
      const expectedOut = gross - expectedFee;

      expect(feeRBTC).to.equal(expectedFee);
      expect(rbtcOut).to.equal(expectedOut);
    });

    it("reverts for unsupported token", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      await expect(
        gasStation.quoteRBTCOut(ethers.ZeroAddress, 1n)
      ).to.be.revertedWith("GasStation: unsupported token");
    });
  });

  // ── 4. quoteTokenIn ────────────────────────────────────────────────────────
  describe("quoteTokenIn", function () {

    it("returns correct USDRIF needed for desired RBTC", async function () {
      const { gasStation, usdrif } = await loadFixture(deployFixture);
      const wantRBTC  = ethers.parseEther("0.00005");
      const tokenIn   = await gasStation.quoteTokenIn(await usdrif.getAddress(), wantRBTC);
      const grossRBTC = (wantRBTC * 10_000n) / (10_000n - FEE_BPS);
      const expected  = (grossRBTC * USDRIF_PER_RBTC) / ethers.parseEther("1");
      expect(tokenIn).to.equal(expected);
    });

    it("reverts for unsupported token", async function () {
      const { gasStation } = await loadFixture(deployFixture);
      await expect(
        gasStation.quoteTokenIn(ethers.ZeroAddress, 1n)
      ).to.be.revertedWith("GasStation: unsupported token");
    });
  });

  // ── 5. swapUSDRIFForRBTC ───────────────────────────────────────────────────
  describe("swapUSDRIFForRBTC", function () {

    it("sends RBTC to user and collects USDRIF", async function () {
      const { gasStation, usdrif, user } = await loadFixture(deployFixture);

      const [rbtcOut] = await gasStation.quoteRBTCOut(
        await usdrif.getAddress(), USDRIF_AMOUNT_IN
      );

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      const balBefore = await ethers.provider.getBalance(user.address);
      const tx        = await gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n);
      const receipt   = await tx.wait();
      const gasUsed   = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter  = await ethers.provider.getBalance(user.address);

      expect(balAfter).to.equal(balBefore + rbtcOut - gasUsed);
      expect(await gasStation.tokenBalance(await usdrif.getAddress())).to.equal(USDRIF_AMOUNT_IN);
    });

    it("emits Swapped event", async function () {
      const { gasStation, usdrif, user } = await loadFixture(deployFixture);

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n)
      ).to.emit(gasStation, "Swapped");
    });

    it("reverts on zero input", async function () {
      const { gasStation, usdrif, user } = await loadFixture(deployFixture);
      await usdrif.connect(user).approve(await gasStation.getAddress(), 1000n);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(0n, 0n)
      ).to.be.revertedWith("GasStation: zero input");
    });

    it("reverts when slippage exceeded", async function () {
      const { gasStation, usdrif, user } = await loadFixture(deployFixture);

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, ethers.parseEther("999"))
      ).to.be.revertedWith("GasStation: slippage exceeded");
    });

    it("reverts when paused", async function () {
      const { gasStation, usdrif, user, owner } = await loadFixture(deployFixture);
      await gasStation.connect(owner).setPaused(true);

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n)
      ).to.be.revertedWith("GasStation: paused");
    });

    it("reverts when RBTC reserve is empty", async function () {
      const { gasStation, usdrif, user, owner } = await loadFixture(deployFixture);

      // Drain reserve
      await gasStation.connect(owner).withdrawRBTC(SEED_RBTC);

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n)
      ).to.be.revertedWith("GasStation: insufficient RBTC reserve");
    });

    it("reverts when output below minRBTCOut", async function () {
      const { gasStation, usdrif, user, owner } = await loadFixture(deployFixture);

      // Set min very high
      await gasStation.connect(owner).setLimits(
        ethers.parseEther("100"),
        ethers.parseEther("200")
      );

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n)
      ).to.be.revertedWith("GasStation: below min output");
    });

    it("reverts when output above maxRBTCOut", async function () {
      const { gasStation, usdrif, user, owner } = await loadFixture(deployFixture);

      // Set max very low
      await gasStation.connect(owner).setLimits(
        ethers.parseEther("0.000000001"),
        ethers.parseEther("0.000000001")
      );

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n)
      ).to.be.revertedWith("GasStation: above max output");
    });
  });

  // ── 6. swapRIFForRBTC ─────────────────────────────────────────────────────
  describe("swapRIFForRBTC", function () {

    it("sends RBTC to user and collects RIF", async function () {
      const { gasStation, rif, user } = await loadFixture(deployFixture);

      const [rbtcOut] = await gasStation.quoteRBTCOut(
        await rif.getAddress(), RIF_AMOUNT_IN
      );

      await rif.connect(user).approve(await gasStation.getAddress(), RIF_AMOUNT_IN);

      const balBefore = await ethers.provider.getBalance(user.address);
      const tx        = await gasStation.connect(user).swapRIFForRBTC(RIF_AMOUNT_IN, 0n);
      const receipt   = await tx.wait();
      const gasUsed   = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter  = await ethers.provider.getBalance(user.address);

      expect(balAfter).to.equal(balBefore + rbtcOut - gasUsed);
    });

    it("emits Swapped event", async function () {
      const { gasStation, rif, user } = await loadFixture(deployFixture);

      await rif.connect(user).approve(await gasStation.getAddress(), RIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapRIFForRBTC(RIF_AMOUNT_IN, 0n)
      ).to.emit(gasStation, "Swapped");
    });

    it("reverts on zero input", async function () {
      const { gasStation, rif, user } = await loadFixture(deployFixture);
      await rif.connect(user).approve(await gasStation.getAddress(), 1000n);

      await expect(
        gasStation.connect(user).swapRIFForRBTC(0n, 0n)
      ).to.be.revertedWith("GasStation: zero input");
    });

    it("reverts when paused", async function () {
      const { gasStation, rif, user, owner } = await loadFixture(deployFixture);
      await gasStation.connect(owner).setPaused(true);

      await rif.connect(user).approve(await gasStation.getAddress(), RIF_AMOUNT_IN);

      await expect(
        gasStation.connect(user).swapRIFForRBTC(RIF_AMOUNT_IN, 0n)
      ).to.be.revertedWith("GasStation: paused");
    });
  });

  // ── 7. Admin ──────────────────────────────────────────────────────────────
  describe("Admin", function () {

    it("owner can update USDRIF rate and emits RateUpdated", async function () {
      const { gasStation, usdrif, owner } = await loadFixture(deployFixture);
      const newRate = 4000n * 10n ** 18n;

      await expect(gasStation.connect(owner).setUSDRIFRate(newRate))
        .to.emit(gasStation, "RateUpdated")
        .withArgs(await usdrif.getAddress(), newRate);

      expect(await gasStation.usdrifPerRBTC()).to.equal(newRate);
    });

    it("owner can update RIF rate and emits RateUpdated", async function () {
      const { gasStation, rif, owner } = await loadFixture(deployFixture);
      const newRate = 2000n * 10n ** 18n;

      await expect(gasStation.connect(owner).setRIFRate(newRate))
        .to.emit(gasStation, "RateUpdated")
        .withArgs(await rif.getAddress(), newRate);

      expect(await gasStation.rifPerRBTC()).to.equal(newRate);
    });

    it("owner can update fee", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      await gasStation.connect(owner).setFeeBps(100);
      expect(await gasStation.feeBps()).to.equal(100);
    });

    it("owner can pause and unpause", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);

      await expect(gasStation.connect(owner).setPaused(true))
        .to.emit(gasStation, "PausedSet").withArgs(true);
      expect(await gasStation.paused()).to.equal(true);

      await gasStation.connect(owner).setPaused(false);
      expect(await gasStation.paused()).to.equal(false);
    });

    it("owner can withdraw collected tokens", async function () {
      const { gasStation, usdrif, user, owner } = await loadFixture(deployFixture);

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);
      await gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n);

      const ownerBalBefore = await usdrif.balanceOf(owner.address);
      await gasStation.connect(owner).withdrawTokens(await usdrif.getAddress(), USDRIF_AMOUNT_IN);
      expect(await usdrif.balanceOf(owner.address)).to.equal(ownerBalBefore + USDRIF_AMOUNT_IN);
    });

    it("owner can withdraw RBTC", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      const amount = ethers.parseEther("0.1");

      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx        = await gasStation.connect(owner).withdrawRBTC(amount);
      const receipt   = await tx.wait();
      const gasUsed   = receipt!.gasUsed * receipt!.gasPrice;
      const balAfter  = await ethers.provider.getBalance(owner.address);

      expect(balAfter).to.equal(balBefore + amount - gasUsed);
    });

    it("owner can transfer ownership", async function () {
      const { gasStation, owner, other } = await loadFixture(deployFixture);

      await expect(gasStation.connect(owner).transferOwnership(other.address))
        .to.emit(gasStation, "OwnershipTransferred")
        .withArgs(owner.address, other.address);

      expect(await gasStation.owner()).to.equal(other.address);
    });

    it("non-owner cannot set USDRIF rate", async function () {
      const { gasStation, user } = await loadFixture(deployFixture);
      await expect(gasStation.connect(user).setUSDRIFRate(1n))
        .to.be.revertedWith("GasStation: not owner");
    });

    it("non-owner cannot set RIF rate", async function () {
      const { gasStation, user } = await loadFixture(deployFixture);
      await expect(gasStation.connect(user).setRIFRate(1n))
        .to.be.revertedWith("GasStation: not owner");
    });

    it("non-owner cannot pause", async function () {
      const { gasStation, user } = await loadFixture(deployFixture);
      await expect(gasStation.connect(user).setPaused(true))
        .to.be.revertedWith("GasStation: not owner");
    });

    it("non-owner cannot withdraw RBTC", async function () {
      const { gasStation, user } = await loadFixture(deployFixture);
      await expect(gasStation.connect(user).withdrawRBTC(1n))
        .to.be.revertedWith("GasStation: not owner");
    });

    it("non-owner cannot withdraw tokens", async function () {
      const { gasStation, usdrif, user } = await loadFixture(deployFixture);
      await expect(
        gasStation.connect(user).withdrawTokens(await usdrif.getAddress(), 1n)
      ).to.be.revertedWith("GasStation: not owner");
    });

    it("non-owner cannot transfer ownership", async function () {
      const { gasStation, user, other } = await loadFixture(deployFixture);
      await expect(gasStation.connect(user).transferOwnership(other.address))
        .to.be.revertedWith("GasStation: not owner");
    });

    it("reverts transferOwnership to zero address", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      await expect(gasStation.connect(owner).transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWith("GasStation: zero address");
    });

    it("reverts setFeeBps >= 100%", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      await expect(gasStation.connect(owner).setFeeBps(10_000))
        .to.be.revertedWith("GasStation: fee >= 100%");
    });

    it("reverts setLimits when min > max", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      await expect(
        gasStation.connect(owner).setLimits(ethers.parseEther("1"), ethers.parseEther("0.1"))
      ).to.be.revertedWith("GasStation: min > max");
    });

    it("reverts withdrawRBTC when amount exceeds balance", async function () {
      const { gasStation, owner } = await loadFixture(deployFixture);
      await expect(
        gasStation.connect(owner).withdrawRBTC(ethers.parseEther("999"))
      ).to.be.revertedWith("GasStation: insufficient balance");
    });
  });

  // ── 8. tokenBalance ────────────────────────────────────────────────────────
  describe("tokenBalance", function () {

    it("returns zero before any swap", async function () {
      const { gasStation, usdrif } = await loadFixture(deployFixture);
      expect(await gasStation.tokenBalance(await usdrif.getAddress())).to.equal(0n);
    });

    it("returns correct balance after swap", async function () {
      const { gasStation, usdrif, user } = await loadFixture(deployFixture);

      await usdrif.connect(user).approve(await gasStation.getAddress(), USDRIF_AMOUNT_IN);
      await gasStation.connect(user).swapUSDRIFForRBTC(USDRIF_AMOUNT_IN, 0n);

      expect(await gasStation.tokenBalance(await usdrif.getAddress())).to.equal(USDRIF_AMOUNT_IN);
    });
  });
});