"use client";
import { WalletState } from "@/hooks/useWallet";
import { shortenAddress, explorerAddr } from "@/lib/utils";

export function Header({ wallet }: { wallet: WalletState }) {
  return (
    <header style={{ borderBottom: "1px solid var(--border)", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: "rgba(255,107,53,.15)", border: "1px solid rgba(255,107,53,.3)", display: "grid", placeItems: "center", fontSize: 16 }}>⛽</div>
        <span style={{ fontFamily: "Syne", fontWeight: 700, fontSize: 18, color: "var(--text)" }}>GasStation</span>
        <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", background: "var(--muted)", color: "var(--sub)", padding: "2px 8px", borderRadius: 6 }}>RSK Testnet</span>
      </div>

      {/* Wallet */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {wallet.address ? (
          <>
            {!wallet.isCorrectNetwork && (
              <button onClick={wallet.switchNetwork} style={btnStyle("rgba(255,107,53,.15)", "rgba(255,107,53,.4)", "var(--orange)")}>
                ⚠ Switch to RSK
              </button>
            )}
            <a href={explorerAddr(wallet.address)} target="_blank" rel="noopener noreferrer"
              style={{ ...btnStyle("var(--panel)", "var(--border)", "var(--text)"), textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: wallet.isCorrectNetwork ? "#4CAF50" : "var(--orange)", display: "inline-block" }} />
              {shortenAddress(wallet.address)}
            </a>
            <button onClick={wallet.disconnect} style={btnStyle("transparent", "var(--border)", "var(--sub)")}>
              Disconnect
            </button>
          </>
        ) : (
          <button onClick={wallet.connect} disabled={wallet.isConnecting}
            style={{ ...btnStyle("var(--orange)", "transparent", "#fff"), opacity: wallet.isConnecting ? .6 : 1, fontWeight: 600 }}>
            {wallet.isConnecting ? "Connecting…" : "Connect Wallet"}
          </button>
        )}
      </div>
    </header>
  );
}

function btnStyle(bg: string, border: string, color: string): React.CSSProperties {
  return { background: bg, border: `1px solid ${border}`, color, borderRadius: 10, padding: "6px 14px", fontSize: 12, fontFamily: "JetBrains Mono", cursor: "pointer" };
}
