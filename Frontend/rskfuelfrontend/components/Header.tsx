"use client";
import { WalletState } from "@/hooks/useWallet";
import { shortenAddress, explorerAddr } from "@/lib/utils";

export function Header({ wallet }: { wallet: WalletState }) {
  return (
    <header style={{
      borderBottom: "1px solid var(--border)",
      padding: "0 32px",
      height: 60,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      backdropFilter: "blur(12px)",
      position: "sticky",
      top: 0,
      zIndex: 100,
      background: "rgba(14,12,10,0.85)",
    }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 28, height: 28,
          background: "var(--accent)",
          borderRadius: 6,
          display: "grid", placeItems: "center",
          fontSize: 13,
        }}>⛽</div>
        <span style={{
          fontFamily: "Instrument Serif",
          fontSize: 18,
          letterSpacing: "-0.01em",
          color: "var(--cream)",
        }}>GasStation</span>
        <span style={{
          fontSize: 10,
          fontFamily: "Geist Mono",
          fontWeight: 400,
          color: "var(--sub)",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          paddingLeft: 10,
          borderLeft: "1px solid var(--border)",
          marginLeft: 2,
        }}>RSK Testnet</span>
      </div>

      {/* Wallet */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {wallet.address ? (
          <>
            {!wallet.isCorrectNetwork && (
              <button onClick={wallet.switchNetwork} style={chip("rgba(232,103,58,.12)", "rgba(232,103,58,.3)", "var(--accent)")}>
                Switch Network
              </button>
            )}
            <a
              href={explorerAddr(wallet.address)}
              target="_blank" rel="noopener noreferrer"
              style={{ ...chip("var(--muted)", "var(--border)", "var(--text)"), textDecoration: "none", gap: 7 }}
            >
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: wallet.isCorrectNetwork ? "#5CB87A" : "var(--accent)",
                display: "inline-block", flexShrink: 0,
              }} />
              {shortenAddress(wallet.address)}
            </a>
            <button
              onClick={wallet.disconnect}
              style={chip("transparent", "var(--border)", "var(--sub)")}
            >
              Disconnect
            </button>
          </>
        ) : (
          <button
            onClick={wallet.connect}
            disabled={wallet.isConnecting}
            style={{
              ...chip("var(--accent)", "transparent", "#fff"),
              fontWeight: 500,
              opacity: wallet.isConnecting ? 0.6 : 1,
            }}
          >
            {wallet.isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}

function chip(bg: string, border: string, color: string): React.CSSProperties {
  return {
    background: bg,
    border: `1px solid ${border}`,
    color,
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 11,
    fontFamily: "Geist Mono",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    letterSpacing: "0.02em",
    whiteSpace: "nowrap" as const,
  };
}