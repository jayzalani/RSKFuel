"use client";
import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { WalletState } from "@/hooks/useWallet";
import { ContractState, getUserBalance, quoteRBTCOut } from "@/hooks/useContractState";
import { useSwap } from "@/hooks/useSwap";
import { TOKENS, TOKEN_ADDRESSES, TokenSymbol, DEFAULT_SLIPPAGE_BPS } from "@/lib/constants";
import { formatRBTC, formatToken, parseTokenInput, applySlippage } from "@/lib/utils";

type Props = { wallet: WalletState; contract: ContractState };

export function SwapCard({ wallet, contract }: Props) {
  const [token, setToken]         = useState<TokenSymbol>("USDRIF");
  const [input, setInput]         = useState("");
  const [rbtcOut, setRbtcOut]     = useState(0n);
  const [feeRBTC, setFeeRBTC]     = useState(0n);
  const [balance, setBalance]     = useState(0n);
  const [quoting, setQuoting]     = useState(false);
  const swap = useSwap();

  const tokenAddr = TOKEN_ADDRESSES[token];
  const amountIn  = parseTokenInput(input);

  const fetchBal = useCallback(async () => {
    if (!wallet.address) return;
    setBalance(await getUserBalance(tokenAddr, wallet.address));
  }, [wallet.address, tokenAddr]);

  useEffect(() => { fetchBal(); }, [fetchBal]);

  useEffect(() => {
    if (!amountIn) { setRbtcOut(0n); setFeeRBTC(0n); return; }
    let dead = false;
    setQuoting(true);
    quoteRBTCOut(tokenAddr, amountIn)
      .then(q => { if (!dead) { setRbtcOut(q.rbtcOut); setFeeRBTC(q.feeRBTC); } })
      .catch(() => { if (!dead) { setRbtcOut(0n); setFeeRBTC(0n); } })
      .finally(() => { if (!dead) setQuoting(false); });
    return () => { dead = true; };
  }, [amountIn, tokenAddr]);

  const handleToken = (t: TokenSymbol) => { setToken(t); setInput(""); setRbtcOut(0n); swap.reset(); };
  const handleMax   = () => setInput(ethers.formatEther(balance));
  const handleSwap  = async () => {
    if (!wallet.signer) return;
    await swap.swap({ tokenAddress: tokenAddr, tokenSymbol: token, tokenAmountIn: amountIn, expectedRBTCOut: rbtcOut, signer: wallet.signer });
    fetchBal(); contract.refresh();
  };

  // Derived
  const connected   = !!wallet.address;
  const rightNet    = wallet.isCorrectNetwork;
  const insuffBal   = amountIn > 0n && amountIn > balance;
  const belowMin    = rbtcOut > 0n && rbtcOut < contract.minRBTCOut;
  const aboveMax    = rbtcOut > 0n && rbtcOut > contract.maxRBTCOut;
  const hasErr      = insuffBal || belowMin || aboveMax;
  const busy        = swap.step === "approving" || swap.step === "swapping";
  const canSwap     = connected && rightNet && !contract.paused && amountIn > 0n && rbtcOut > 0n && !hasErr && !busy && swap.step !== "success";

  return (
    <div style={{ width: "100%", maxWidth: 440, background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 20, padding: 24, boxShadow: "0 0 40px rgba(255,107,53,.08)" }}>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <span style={{ fontFamily: "Syne", fontWeight: 700, fontSize: 17, color: "var(--text)" }}>Swap for RBTC</span>
        <button onClick={() => { fetchBal(); contract.refresh(); }} title="Refresh"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--sub)", fontSize: 16 }}>↻</button>
      </div>

      {/* Paused banner */}
      {contract.paused && (
        <div style={{ background: "rgba(255,85,85,.1)", border: "1px solid rgba(255,85,85,.3)", borderRadius: 10, padding: "8px 14px", marginBottom: 16, fontSize: 12, fontFamily: "JetBrains Mono", color: "#FF7070", textAlign: "center" }}>
          ⛔ Gas Station paused
        </div>
      )}

      {/* Token tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {TOKENS.map(t => (
          <button key={t.symbol} onClick={() => handleToken(t.symbol)}
            style={{ flex: 1, padding: "8px 0", borderRadius: 10, fontFamily: "JetBrains Mono", fontWeight: 600, fontSize: 13, cursor: "pointer", transition: "all .15s",
              background: token === t.symbol ? "rgba(255,107,53,.15)" : "var(--muted)",
              border: `1px solid ${token === t.symbol ? "rgba(255,107,53,.5)" : "transparent"}`,
              color: token === t.symbol ? "var(--orange)" : "var(--sub)" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Pay input */}
      <label style={{ display: "block", fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--sub)", marginBottom: 6 }}>You pay</label>
      <div style={{ display: "flex", alignItems: "center", background: "var(--muted)", border: `1px solid ${insuffBal ? "rgba(255,85,85,.5)" : "var(--border)"}`, borderRadius: 12, padding: "10px 14px", marginBottom: 4 }}>
        <input type="number" min="0" step="any" placeholder="0.00" value={input} onChange={e => setInput(e.target.value)}
          style={{ flex: 1, background: "none", border: "none", outline: "none", fontSize: 22, fontFamily: "JetBrains Mono", color: "var(--text)" }} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontFamily: "JetBrains Mono", fontWeight: 600, fontSize: 13, color: "var(--orange)" }}>{token}</span>
          {wallet.address && (
            <button onClick={handleMax} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--sub)" }}>
              Bal: {formatToken(balance)}
            </button>
          )}
        </div>
      </div>
      {insuffBal && <p style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "#FF7070", marginBottom: 4, marginLeft: 4 }}>Insufficient balance</p>}

      {/* Arrow */}
      <div style={{ display: "flex", justifyContent: "center", margin: "10px 0" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: "var(--muted)", border: "1px solid var(--border)", display: "grid", placeItems: "center", color: "var(--sub)", fontSize: 14 }}>↓</div>
      </div>

      {/* RBTC output */}
      <label style={{ display: "block", fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--sub)", marginBottom: 6 }}>You receive</label>
      <div style={{ display: "flex", alignItems: "center", background: rbtcOut > 0n ? "rgba(255,107,53,.05)" : "var(--muted)", border: `1px solid ${rbtcOut > 0n ? "rgba(255,107,53,.3)" : "var(--border)"}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>
        {quoting
          ? <div style={{ height: 28, width: 120, borderRadius: 6 }} className="shimmer" />
          : <span style={{ flex: 1, fontSize: 22, fontFamily: "JetBrains Mono", fontWeight: 600, color: rbtcOut > 0n ? "var(--orange)" : "var(--sub)" }}>
              {rbtcOut > 0n ? formatRBTC(rbtcOut) : "0.000000"}
            </span>
        }
        <span style={{ fontFamily: "JetBrains Mono", fontWeight: 600, fontSize: 13, color: "var(--text)" }}>RBTC</span>
      </div>

      {/* Breakdown */}
      {rbtcOut > 0n && !quoting && (
        <div style={{ background: "#0A0A0F", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", flexDirection: "column", gap: 5 }}>
          <Row k="Fee" v={`${formatRBTC(feeRBTC, 8)} RBTC`} />
          <Row k="Min received (0.5%)" v={`${formatRBTC(applySlippage(rbtcOut, DEFAULT_SLIPPAGE_BPS))} RBTC`} />
          {belowMin && <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "#FF7070" }}>⚠ Below min output ({formatRBTC(contract.minRBTCOut)} RBTC)</span>}
          {aboveMax && <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "#FF7070" }}>⚠ Above max output ({formatRBTC(contract.maxRBTCOut)} RBTC)</span>}
        </div>
      )}

      {/* CTA */}
      <CTA wallet={wallet} canSwap={canSwap} busy={busy} step={swap.step} onSwap={handleSwap} onConnect={wallet.connect} onSwitch={wallet.switchNetwork} />

      {/* Success */}
      {swap.step === "success" && swap.txUrl && (
        <div style={{ marginTop: 12, background: "rgba(76,175,80,.1)", border: "1px solid rgba(76,175,80,.3)", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, fontFamily: "JetBrains Mono", color: "#66BB6A" }}>
          <span>✓ Swap successful!</span>
          <a href={swap.txUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#66BB6A" }}>View tx ↗</a>
        </div>
      )}

      {/* Error */}
      {swap.step === "error" && swap.error && (
        <div style={{ marginTop: 12, background: "rgba(255,85,85,.1)", border: "1px solid rgba(255,85,85,.3)", borderRadius: 10, padding: "10px 14px", fontSize: 11, fontFamily: "JetBrains Mono", color: "#FF7070" }}>
          {swap.error}{" "}
          <button onClick={swap.reset} style={{ background: "none", border: "none", color: "#FF7070", cursor: "pointer", textDecoration: "underline", fontSize: 11, fontFamily: "JetBrains Mono" }}>Dismiss</button>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "JetBrains Mono" }}>
      <span style={{ color: "var(--sub)" }}>{k}</span>
      <span style={{ color: "var(--text)" }}>{v}</span>
    </div>
  );
}

function CTA({ wallet, canSwap, busy, step, onSwap, onConnect, onSwitch }: any) {
  let label = "Enter an amount";
  let action: any = undefined;
  let disabled = true;
  let bg = "var(--muted)"; let color = "var(--sub)"; let border = "var(--border)";

  if (!wallet.address) {
    label = "Connect Wallet"; action = onConnect; disabled = false;
    bg = "var(--orange)"; color = "#fff"; border = "transparent";
  } else if (!wallet.isCorrectNetwork) {
    label = "Switch to RSK Testnet"; action = onSwitch; disabled = false;
    bg = "rgba(255,107,53,.15)"; color = "var(--orange)"; border = "rgba(255,107,53,.4)";
  } else if (busy) {
    label = step === "approving" ? "Approving…" : "Swapping…"; disabled = true;
    bg = "rgba(255,107,53,.2)"; color = "var(--orange)"; border = "rgba(255,107,53,.3)";
  } else if (canSwap) {
    label = "Swap for RBTC →"; action = onSwap; disabled = false;
    bg = "linear-gradient(135deg,#FF6B35,#FFB347)"; color = "#fff"; border = "transparent";
  }

  return (
    <button onClick={action} disabled={disabled}
      style={{ width: "100%", padding: "13px 0", borderRadius: 12, fontFamily: "Syne", fontWeight: 700, fontSize: 14, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled && label !== "Enter an amount" ? .6 : 1, transition: "opacity .15s", background: bg, color, border: `1px solid ${border}` }}>
      {busy
        ? <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span className="spin" style={{ display: "inline-block", width: 14, height: 14, border: "2px solid currentColor", borderTopColor: "transparent", borderRadius: "50%" }} />
            {label}
          </span>
        : label}
    </button>
  );
}
