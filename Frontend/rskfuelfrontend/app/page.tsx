"use client";
import { useWallet } from "@/hooks/useWallet";
import { useContractState } from "@/hooks/useContractState";
import { Header } from "@/components/Header";
import { StatsBar } from "@/components/StatsBar";
import { SwapCard } from "@/components/SwapCard";

export default function Home() {
  const wallet   = useWallet();
  const contract = useContractState();

  return (
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", position: "relative" }}>
      {/* Background glow */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", top: "5%", left: "50%", transform: "translateX(-50%)", width: 700, height: 400, background: "radial-gradient(ellipse, rgba(255,107,53,.07) 0%, transparent 70%)", filter: "blur(40px)" }} />
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: .025 }}>
          <defs>
            <pattern id="g" width="56" height="56" patternUnits="userSpaceOnUse">
              <path d="M 56 0 L 0 0 0 56" fill="none" stroke="#FF6B35" strokeWidth=".5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#g)" />
        </svg>
      </div>

      {/* UI */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Header wallet={wallet} />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 16px", gap: 24 }}>
          {/* Hero */}
          <div style={{ textAlign: "center", maxWidth: 480 }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,107,53,.1)", border: "1px solid rgba(255,107,53,.3)", borderRadius: 20, padding: "3px 12px", fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--orange)", marginBottom: 18 }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)", display: "inline-block" }} />
              RSK Testnet · Live
            </div>
            <h1 style={{ fontFamily: "Syne", fontWeight: 800, fontSize: "clamp(2rem,5vw,2.8rem)", lineHeight: 1.15, color: "var(--text)", marginBottom: 10 }}>
              Refuel your{" "}
              <span style={{ color: "var(--orange)", textShadow: "0 0 24px rgba(255,107,53,.4)" }}>RBTC</span>
            </h1>
            <p style={{ color: "var(--sub)", fontSize: 15, lineHeight: 1.6 }}>
              Pay with USDRIF or RIF. Receive RBTC gas instantly — no bridges, no waiting.
            </p>
          </div>

          <StatsBar c={contract} />
          <SwapCard wallet={wallet} contract={contract} />
        </div>

        <footer style={{ textAlign: "center", padding: "18px 0", fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--sub)", borderTop: "1px solid var(--border)" }}>
          Built on{" "}
          <a href="https://rootstock.io" target="_blank" rel="noopener noreferrer" style={{ color: "var(--orange)", textDecoration: "none" }}>Rootstock</a>
          {" "}· Testnet only
        </footer>
      </div>
    </main>
  );
}
