"use client";
import { ethers } from "ethers";
import { ContractState } from "@/hooks/useContractState";
import { formatRBTC } from "@/lib/utils";

export function StatsBar({ c }: { c: ContractState }) {
  const fmt = (v: bigint) => c.isLoading ? "…" : parseFloat(ethers.formatEther(v)).toFixed(0);

  const stats = [
    { label: "RBTC Reserve",  value: c.isLoading ? "…" : `${formatRBTC(c.rbtcReserve, 5)} RBTC` },
    { label: "USDRIF / RBTC", value: fmt(c.usdrifPerRBTC) },
    { label: "RIF / RBTC",    value: fmt(c.rifPerRBTC) },
    { label: "Fee",            value: c.isLoading ? "…" : `${(Number(c.feeBps) / 100).toFixed(2)}%` },
    { label: "Status",         value: c.isLoading ? "…" : c.paused ? "Paused" : "Active", color: c.paused ? "#FF5555" : "#4CAF50" },
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 1, borderRadius: 14, overflow: "hidden", border: "1px solid var(--border)", background: "var(--border)", maxWidth: 620, width: "100%" }}>
      {stats.map(s => (
        <div key={s.label} style={{ flex: "1 1 100px", background: "var(--panel)", padding: "10px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--sub)" }}>{s.label}</span>
          <span style={{ fontSize: 13, fontFamily: "JetBrains Mono", fontWeight: 600, color: s.color ?? "var(--text)" }}>{s.value}</span>
        </div>
      ))}
    </div>
  );
}
