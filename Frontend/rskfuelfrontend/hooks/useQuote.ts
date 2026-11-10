"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { TokenSymbol } from "@/lib/constants";

export type Quote = {
  token: TokenSymbol;
  tokenAddress: string;
  tokenAmountIn: string; // wei
  rbtcOut: string; // wei — exactly what the contract will pay
  deadline: number | null; // unix seconds; null = indicative (no wallet yet)
  nonce: string | null;
  signature: string | null;
  fetchedAt: number;
  rates: { btcUsd: number; rifUsd: number; tokenUsd: number };
  breakdown: {
    valueUsd: number;
    grossRbtc: string;
    gasFeeUsd: number;
    gasFeeRbtc: string;
    spreadBps: number;
    spreadRbtc: string;
    totalFeeRbtc: string;
    effectiveFeePct: number;
  };
};

const REFRESH_MS = 20_000; // re-price while the user is looking at the screen
const DEBOUNCE_MS = 400;

/**
 * Fetches a live, fee-inclusive quote for the entered amount, re-prices it
 * every 20s, and exposes a countdown. `paused` freezes refreshing while a
 * swap is in flight so the signed quote can't change underneath the user.
 */
export function useQuote(token: TokenSymbol, amount: string, user: string | null, paused = false) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const reqId = useRef(0);

  const fetchQuote = useCallback(async () => {
    if (!(parseFloat(amount) > 0)) {
      reqId.current++;
      setQuote(null); setError(null); setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, amountIn: amount, userAddress: user }),
      });
      const data = await res.json();
      if (id !== reqId.current) return; // a newer request superseded this one
      if (!res.ok) { setQuote(null); setError(data.error ?? "Could not get a quote"); }
      else { setQuote(data); setError(null); }
    } catch {
      if (id === reqId.current) { setQuote(null); setError("Network error — retrying"); }
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [token, amount, user]);

  useEffect(() => {
    if (paused) return;
    const d = setTimeout(fetchQuote, DEBOUNCE_MS);
    const t = setInterval(fetchQuote, REFRESH_MS);
    return () => { clearTimeout(d); clearInterval(t); };
  }, [fetchQuote, paused]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const secondsLeft = quote?.deadline ? Math.max(0, quote.deadline - Math.floor(now / 1000)) : null;

  return { quote, loading, error, secondsLeft, refresh: fetchQuote };
}