"use client";
import { useEffect, useState } from "react";
import { useLivePrice } from "@/hooks/useLivePrice";

/** Prominent RBTC/USD and RIF/USD display. Drop it in page.tsx above <StatsBar />. */
export function LivePrices() {
  const live = useLivePrice();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const age = live.updatedAt ? Math.max(0, Math.round((now - live.updatedAt) / 1000)) : null;
  const dot = live.error ? "#E05252" : live.stale ? "#E0A552" : "#5CB87A";

  const items = [
    { label: "RBTC / USD", value: live.rbtcUsd != null ? `$${live.rbtcUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—" },
    { label: "RIF / USD",  value: live.rifUsd  != null ? `$${live.rifUsd.toFixed(4)}` : "—" },
  ];

  return (
    <div style={{ width: "100%", maxWidth: 680, display: "flex", gap: 10, alignItems: "stretch" }}>
      {items.map(i => (
        <div key={i.label} style={{ flex: 1, border: "1px solid var(--border)", borderRadius: 14, background: "var(--panel)", padding: "14px 18px" }}>
          <div style={{ fontSize: 9, fontFamily: "Geist Mono", color: "var(--sub)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>{i.label}</div>
          <div style={{ fontSize: 20, fontFamily: "Geist Mono", fontWeight: 500, color: "var(--cream)", letterSpacing: "-0.02em" }}>
            {live.loading ? "…" : i.value}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontFamily: "Geist Mono", color: "var(--sub)", padding: "0 6px", whiteSpace: "nowrap" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot, display: "inline-block" }} className={live.error ? "" : "pulse"} />
        {live.error ? "unavailable" : live.stale ? "stale" : "live"}{age != null && !live.error ? ` · ${age}s` : ""}
      </div>
    </div>
  );
}