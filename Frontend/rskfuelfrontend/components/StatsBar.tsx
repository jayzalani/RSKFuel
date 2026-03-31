"use client";
import { ethers } from "ethers";
import { ContractState } from "@/hooks/useContractState";
import { formatRBTC } from "@/lib/utils";

export function StatsBar({ c }: { c: ContractState }) {
  const fmt = (v: bigint) => c.isLoading ? "—" : parseFloat(ethers.formatEther(v)).toFixed(0);

  const stats = [
    { label: "RBTC Reserve",  value: c.isLoading ? "—" : `${formatRBTC(c.rbtcReserve, 5)}` , unit: "RBTC" },
    { label: "USDRIF Rate",   value: fmt(c.usdrifPerRBTC), unit: "/ RBTC" },
    { label: "RIF Rate",      value: fmt(c.rifPerRBTC),    unit: "/ RBTC" },
    { label: "Fee",           value: c.isLoading ? "—" : `${(Number(c.feeBps) / 100).toFixed(2)}`, unit: "%" },
    { label: "Status",        value: c.isLoading ? "—" : c.paused ? "Paused" : "Live",
      color: c.paused ? "#E05252" : "#5CB87A", dot: true },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      width: "100%",
      maxWidth: 680,
      border: "1px solid var(--border)",
      borderRadius: 14,
      overflow: "hidden",
      background: "var(--panel)",
    }}>
      {stats.map((s, i) => (
        <div key={s.label} style={{
          padding: "16px 18px",
          borderRight: i < stats.length - 1 ? "1px solid var(--border)" : "none",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          <span style={{
            fontSize: 9,
            fontFamily: "Geist Mono",
            fontWeight: 400,
            color: "var(--sub)",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}>{s.label}</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            {s.dot && (
              <span style={{
                width: 5, height: 5, borderRadius: "50%",
                background: s.color,
                display: "inline-block",
                marginBottom: 1,
                flexShrink: 0,
              }} className={!c.paused && !c.isLoading ? "pulse" : ""} />
            )}
            <span style={{
              fontSize: 15,
              fontFamily: "Geist Mono",
              fontWeight: 500,
              color: s.color ?? "var(--cream)",
              letterSpacing: "-0.02em",
            }}>{s.value}</span>
            {s.unit && (
              <span style={{
                fontSize: 9,
                fontFamily: "Geist Mono",
                color: "var(--sub)",
                letterSpacing: "0.04em",
              }}>{s.unit}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}