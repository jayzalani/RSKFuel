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
  const [token, setToken]     = useState<TokenSymbol>("USDRIF");
  const [input, setInput]     = useState("");
  const [rbtcOut, setRbtcOut] = useState(0n);
  const [feeRBTC, setFeeRBTC] = useState(0n);
  const [balance, setBalance] = useState(0n);
  const [quoting, setQuoting] = useState(false);
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

  const connected = !!wallet.address;
  const rightNet  = wallet.isCorrectNetwork;
  const insuffBal = amountIn > 0n && amountIn > balance;
  const belowMin  = rbtcOut > 0n && rbtcOut < contract.minRBTCOut;
  const aboveMax  = rbtcOut > 0n && rbtcOut > contract.maxRBTCOut;
  const hasErr    = insuffBal || belowMin || aboveMax;
  const busy      = swap.step === "approving" || swap.step === "swapping";
  const canSwap   = connected && rightNet && !contract.paused && amountIn > 0n && rbtcOut > 0n && !hasErr && !busy && swap.step !== "success";

  return (
    <div style={{
      width: "100%",
      maxWidth: 420,
      background: "var(--panel)",
      border: "1px solid var(--border)",
      borderRadius: 20,
      overflow: "hidden",
    }} className="fade-up">

      {/* Paused banner */}
      {contract.paused && (
        <div style={{
          background: "rgba(224,82,82,.08)",
          borderBottom: "1px solid rgba(224,82,82,.2)",
          padding: "9px 20px",
          fontSize: 11,
          fontFamily: "Geist Mono",
          color: "#E05252",
          textAlign: "center",
          letterSpacing: "0.04em",
        }}>
          ⛔ Contract paused
        </div>
      )}

      <div style={{ padding: "22px 22px 0" }}>
        {/* Header row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <span style={{
            fontFamily: "Instrument Serif",
            fontSize: 20,
            color: "var(--cream)",
            letterSpacing: "-0.01em",
          }}>Swap for RBTC</span>
          <button
            onClick={() => { fetchBal(); contract.refresh(); }}
            title="Refresh"
            style={{
              background: "none", border: "1px solid var(--border)",
              cursor: "pointer", color: "var(--sub)",
              fontSize: 13, width: 28, height: 28,
              borderRadius: 7, display: "grid", placeItems: "center",
            }}
          >↻</button>
        </div>

        {/* Token selector */}
        <div style={{
          display: "flex",
          background: "var(--muted)",
          borderRadius: 10,
          padding: 3,
          marginBottom: 18,
          gap: 3,
        }}>
          {TOKENS.map(t => (
            <button
              key={t.symbol}
              onClick={() => handleToken(t.symbol)}
              style={{
                flex: 1,
                padding: "7px 0",
                borderRadius: 8,
                fontFamily: "Geist Mono",
                fontWeight: token === t.symbol ? 500 : 400,
                fontSize: 12,
                cursor: "pointer",
                transition: "all .2s",
                background: token === t.symbol ? "var(--panel)" : "transparent",
                border: token === t.symbol ? "1px solid var(--border)" : "1px solid transparent",
                color: token === t.symbol ? "var(--cream)" : "var(--sub)",
                letterSpacing: "0.02em",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Pay input */}
        <div style={{ marginBottom: 2 }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 7,
          }}>
            <span style={{ fontSize: 10, fontFamily: "Geist Mono", color: "var(--sub)", letterSpacing: "0.08em", textTransform: "uppercase" }}>You pay</span>
            {wallet.address && (
              <button
                onClick={handleMax}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  fontSize: 10, fontFamily: "Geist Mono", color: "var(--sub)",
                  letterSpacing: "0.04em",
                }}
              >
                Balance: {formatToken(balance)} {token}
              </button>
            )}
          </div>
          <div style={{
            display: "flex",
            alignItems: "center",
            background: "var(--muted)",
            border: `1px solid ${insuffBal ? "rgba(224,82,82,.4)" : "var(--border)"}`,
            borderRadius: 12,
            padding: "12px 14px",
            transition: "border-color .2s",
          }}>
            <input
              type="number" min="0" step="any"
              placeholder="0.00"
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{
                flex: 1,
                background: "none", border: "none", outline: "none",
                fontSize: 24,
                fontFamily: "Geist Mono",
                fontWeight: 300,
                color: "var(--cream)",
                letterSpacing: "-0.02em",
              }}
            />
            <span style={{
              fontFamily: "Geist Mono",
              fontWeight: 500,
              fontSize: 12,
              color: "var(--accent)",
              letterSpacing: "0.06em",
            }}>{token}</span>
          </div>
          {insuffBal && (
            <p style={{ fontSize: 10, fontFamily: "Geist Mono", color: "#E05252", marginTop: 5, letterSpacing: "0.04em" }}>
              Insufficient balance
            </p>
          )}
        </div>

        {/* Divider with arrow */}
        <div style={{ display: "flex", justifyContent: "center", margin: "14px 0" }}>
          <div style={{
            width: 28, height: 28,
            borderRadius: 8,
            background: "var(--ink)",
            border: "1px solid var(--border)",
            display: "grid", placeItems: "center",
            color: "var(--sub)",
            fontSize: 12,
          }}>↓</div>
        </div>

        {/* Receive output */}
        <div style={{ marginBottom: 16 }}>
          <span style={{
            display: "block",
            fontSize: 10, fontFamily: "Geist Mono", color: "var(--sub)",
            letterSpacing: "0.08em", textTransform: "uppercase",
            marginBottom: 7,
          }}>You receive</span>
          <div style={{
            display: "flex",
            alignItems: "center",
            background: rbtcOut > 0n ? "rgba(232,103,58,.05)" : "var(--muted)",
            border: `1px solid ${rbtcOut > 0n ? "rgba(232,103,58,.25)" : "var(--border)"}`,
            borderRadius: 12,
            padding: "12px 14px",
            transition: "all .2s",
          }}>
            {quoting
              ? <div style={{ height: 30, width: 100, borderRadius: 6, flex: 1 }} className="shimmer" />
              : <span style={{
                  flex: 1,
                  fontSize: 24,
                  fontFamily: "Geist Mono",
                  fontWeight: rbtcOut > 0n ? 400 : 300,
                  color: rbtcOut > 0n ? "var(--accent)" : "var(--sub)",
                  letterSpacing: "-0.02em",
                }}>
                  {rbtcOut > 0n ? formatRBTC(rbtcOut) : "0.000000"}
                </span>
            }
            <span style={{
              fontFamily: "Geist Mono",
              fontWeight: 500,
              fontSize: 12,
              color: "var(--cream)",
              letterSpacing: "0.06em",
            }}>RBTC</span>
          </div>
        </div>

        {/* Breakdown */}
        {rbtcOut > 0n && !quoting && (
          <div style={{
            background: "var(--ink)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}>
            <Row k="Protocol fee" v={`${formatRBTC(feeRBTC, 8)} RBTC`} />
            <Row k="Min received (0.5% slippage)" v={`${formatRBTC(applySlippage(rbtcOut, DEFAULT_SLIPPAGE_BPS))} RBTC`} />
            {belowMin && (
              <span style={{ fontSize: 10, fontFamily: "Geist Mono", color: "#E05252", letterSpacing: "0.03em" }}>
                Below minimum output ({formatRBTC(contract.minRBTCOut)} RBTC)
              </span>
            )}
            {aboveMax && (
              <span style={{ fontSize: 10, fontFamily: "Geist Mono", color: "#E05252", letterSpacing: "0.03em" }}>
                Exceeds maximum output ({formatRBTC(contract.maxRBTCOut)} RBTC)
              </span>
            )}
          </div>
        )}
      </div>

      {/* CTA */}
      <div style={{ padding: "0 22px 22px" }}>
        <CTA
          wallet={wallet}
          canSwap={canSwap}
          busy={busy}
          step={swap.step}
          onSwap={handleSwap}
          onConnect={wallet.connect}
          onSwitch={wallet.switchNetwork}
        />

        {/* Success */}
        {swap.step === "success" && swap.txUrl && (
          <div style={{
            marginTop: 10,
            background: "rgba(92,184,122,.07)",
            border: "1px solid rgba(92,184,122,.25)",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 11,
            fontFamily: "Geist Mono",
            color: "#5CB87A",
            letterSpacing: "0.02em",
          }}>
            <span>✓ Swap confirmed</span>
            <a href={swap.txUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#5CB87A" }}>
              View tx ↗
            </a>
          </div>
        )}

        {/* Error */}
        {swap.step === "error" && swap.error && (
          <div style={{
            marginTop: 10,
            background: "rgba(224,82,82,.07)",
            border: "1px solid rgba(224,82,82,.2)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 11,
            fontFamily: "Geist Mono",
            color: "#E07070",
            letterSpacing: "0.02em",
          }}>
            {swap.error}{" "}
            <button
              onClick={swap.reset}
              style={{
                background: "none", border: "none", color: "#E07070",
                cursor: "pointer", textDecoration: "underline",
                fontSize: 11, fontFamily: "Geist Mono",
              }}
            >Dismiss</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontFamily: "Geist Mono", letterSpacing: "0.02em" }}>
      <span style={{ color: "var(--sub)" }}>{k}</span>
      <span style={{ color: "var(--text)" }}>{v}</span>
    </div>
  );
}

function CTA({ wallet, canSwap, busy, step, onSwap, onConnect, onSwitch }: any) {
  let label    = "Enter an amount";
  let action: any = undefined;
  let disabled = true;
  let style: React.CSSProperties = {
    background: "var(--muted)", color: "var(--sub)", border: "1px solid var(--border)",
  };

  if (!wallet.address) {
    label = "Connect Wallet"; action = onConnect; disabled = false;
    style = { background: "var(--accent)", color: "#fff", border: "1px solid transparent" };
  } else if (!wallet.isCorrectNetwork) {
    label = "Switch to RSK Testnet"; action = onSwitch; disabled = false;
    style = { background: "rgba(232,103,58,.1)", color: "var(--accent)", border: "1px solid rgba(232,103,58,.3)" };
  } else if (busy) {
    label = step === "approving" ? "Approving…" : "Swapping…"; disabled = true;
    style = { background: "rgba(232,103,58,.1)", color: "var(--accent)", border: "1px solid rgba(232,103,58,.2)" };
  } else if (canSwap) {
    label = "Swap for RBTC"; action = onSwap; disabled = false;
    style = { background: "var(--accent)", color: "#fff", border: "1px solid transparent" };
  }

  return (
    <button
      onClick={action}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "13px 0",
        borderRadius: 12,
        fontFamily: "Geist",
        fontWeight: 500,
        fontSize: 13,
        letterSpacing: "0.02em",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && label !== "Enter an amount" ? 0.55 : 1,
        transition: "opacity .15s",
        ...style,
      }}
    >
      {busy
        ? (
          <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <span className="spin" style={{
              display: "inline-block",
              width: 12, height: 12,
              border: "1.5px solid currentColor",
              borderTopColor: "transparent",
              borderRadius: "50%",
            }} />
            {label}
          </span>
        )
        : label
      }
    </button>
  );
}