import { useEffect, useState, useCallback } from "react";

/**
 * useLivePrice — polls /api/live-price for a fast, always-current DISPLAY
 * price. This is cosmetic/informational only: the real, protected quote
 * for an actual swap still comes from the contract via useContractState's
 * usdrifPerRBTC()/rifPerRBTC() (or quoteRBTCOut/quoteTokenIn directly).
 *
 * Runs once on mount (so a refresh always shows a current number
 * immediately) and then every POLL_INTERVAL_MS after that.
 */

const POLL_INTERVAL_MS = 15_000; // matches useContractState's on-chain poll cadence

export interface LivePrice {
  rbtcUsd: number | null;
  rifUsd: number | null;
  usdrifPerRBTC: number | null;
  rifPerRBTC: number | null;
  updatedAt: number | null;
  stale: boolean;
  loading: boolean;
  error: string | null;
}

export function useLivePrice(): LivePrice {
  const [state, setState] = useState<LivePrice>({
    rbtcUsd: null,
    rifUsd: null,
    usdrifPerRBTC: null,
    rifPerRBTC: null,
    updatedAt: null,
    stale: false,
    loading: true,
    error: null,
  });

  const fetchPrice = useCallback(async () => {
    try {
      const res = await fetch("/api/live-price");
      const data = await res.json();

      if (!res.ok || data.error) {
        setState((prev) => ({ ...prev, loading: false, error: data.error ?? "failed to fetch price" }));
        return;
      }

      setState({
        rbtcUsd: data.rbtcUsd,
        rifUsd: data.rifUsd,
        usdrifPerRBTC: data.usdrifPerRBTC,
        rifPerRBTC: data.rifPerRBTC,
        updatedAt: data.updatedAt,
        stale: !!data.stale,
        loading: false,
        error: null,
      });
    } catch (err: any) {
      setState((prev) => ({ ...prev, loading: false, error: err.message ?? "network error" }));
    }
  }, []);

  useEffect(() => {
    fetchPrice(); // immediately on mount/refresh
    const interval = setInterval(fetchPrice, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchPrice]);

  return state;
}