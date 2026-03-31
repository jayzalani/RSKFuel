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
    <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Subtle ambient background */}
      
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden",
      }}>
        {/* Top centre warm glow */}
        <div style={{
          position: "absolute",
          top: "-10%", left: "50%",
          transform: "translateX(-50%)",
          width: 600, height: 500,
          background: "radial-gradient(ellipse, rgba(232,103,58,.06) 0%, transparent 65%)",
        }} />
        {/* Bottom right accent */}
        <div style={{
          position: "absolute",
          bottom: "-5%", right: "10%",
          width: 300, height: 300,
          background: "radial-gradient(ellipse, rgba(201,151,58,.04) 0%, transparent 70%)",
        }} />
        {/* Dot grid texture */}
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: .03 }}>
          <defs>
            <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#F5F0E8" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
      </div>

      {/* UI */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <Header wallet={wallet} />

        <div style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 20px 40px",
          gap: 28,
        }}>
          {/* Hero */}
          <div style={{ textAlign: "center", maxWidth: 500 }} className="fade-up">
            {/* Status pill */}
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              border: "1px solid var(--border)",
              borderRadius: 20,
              padding: "4px 12px 4px 10px",
              fontSize: 10,
              fontFamily: "Geist Mono",
              color: "var(--sub)",
              letterSpacing: "0.08em",
              marginBottom: 22,
            }}>
              <span className="pulse" style={{
                width: 5, height: 5, borderRadius: "50%",
                background: "#5CB87A", display: "inline-block",
              }} />
              LIVE ON RSK TESTNET
            </div>

            <h1 style={{
              fontFamily: "Instrument Serif",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: "clamp(2.4rem, 6vw, 3.4rem)",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              color: "var(--cream)",
              marginBottom: 14,
            }}>
              Refuel your RBTC
            </h1>

            <p style={{
              color: "var(--sub)",
              fontSize: 14,
              lineHeight: 1.65,
              fontWeight: 300,
              maxWidth: 360,
              margin: "0 auto",
            }}>
              Pay with USDRIF or RIF.<br />
              Receive RBTC gas instantly — no bridges, no waiting.
            </p>
          </div>

          <StatsBar c={contract} />
          <SwapCard wallet={wallet} contract={contract} />
        </div>

        <footer style={{
          textAlign: "center",
          padding: "16px 0",
          fontSize: 10,
          fontFamily: "Geist Mono",
          color: "var(--sub)",
          borderTop: "1px solid var(--border)",
          letterSpacing: "0.08em",
        }}>
          BUILT ON{" "}
          <a
            href="https://rootstock.io"
            target="_blank" rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "none" }}
          >ROOTSTOCK</a>
          {" "}· TESTNET ONLY
        </footer>
      </div>
    </main>
  );
}