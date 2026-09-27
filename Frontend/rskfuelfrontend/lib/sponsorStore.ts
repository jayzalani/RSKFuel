/**
 * Anti-abuse store for gas sponsorship.
 *
 * The old /api/sponsor route would send RBTC to ANY address reporting a
 * low balance, with no memory of who it already paid. On mainnet that's
 * a script generating free wallets in a loop, draining the sponsor wallet
 * for good. This module tracks two things:
 *
 *   1. Has this specific address already been sponsored? (one-time, ever)
 *   2. How many sponsorships has this IP triggered in the last 24h?
 *
 * ── IMPORTANT ─────────────────────────────────────────────────────────
 * InMemorySponsorStore is ONLY for local development / a single
 * long-running Node process. On Vercel (or any serverless/multi-instance
 * host) each request can land on a different instance with its own empty
 * memory, so it will NOT reliably stop abuse in production.
 *
 * Before going to mainnet, switch SPONSOR_STORE below to a real shared
 * store. UpstashSponsorStore is included as a ready-to-use option
 * (Upstash Redis has a free tier and a simple REST API that works well
 * with serverless functions — https://upstash.com). To use it:
 *   1. npm install @upstash/redis
 *   2. Create a Redis database at upstash.com, copy its REST URL + token
 *   3. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your
 *      Vercel project env vars
 *   4. Flip SPONSOR_STORE (bottom of this file) to `upstashSponsorStore`
 * Any other Redis/DB works too — just implement the same SponsorStore
 * interface.
 */

export interface SponsorStore {
  hasBeenSponsored(address: string): Promise<boolean>;
  markSponsored(address: string): Promise<void>;
  /** Returns how many sponsorships this IP has triggered in the current window. */
  getIpSponsorCount(ip: string): Promise<number>;
  recordIpSponsorship(ip: string): Promise<void>;
}

const IP_WINDOW_SECONDS = 24 * 60 * 60; // 24h rolling window per IP

// ── Development-only in-memory implementation ──────────────────────────────

class InMemorySponsorStore implements SponsorStore {
  private sponsoredAddresses = new Set<string>();
  private ipHits = new Map<string, number[]>(); // ip -> array of epoch-second timestamps

  async hasBeenSponsored(address: string): Promise<boolean> {
    return this.sponsoredAddresses.has(address.toLowerCase());
  }

  async markSponsored(address: string): Promise<void> {
    this.sponsoredAddresses.add(address.toLowerCase());
  }

  async getIpSponsorCount(ip: string): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    const hits = (this.ipHits.get(ip) ?? []).filter((t) => now - t < IP_WINDOW_SECONDS);
    this.ipHits.set(ip, hits);
    return hits.length;
  }

  async recordIpSponsorship(ip: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const hits = this.ipHits.get(ip) ?? [];
    hits.push(now);
    this.ipHits.set(ip, hits);
  }
}

// ── Production-ready implementation (Upstash Redis) ────────────────────────
// Not wired in by default so this file has no hard dependency on
// @upstash/redis until you actually install it and switch to it below.

class UpstashSponsorStore implements SponsorStore {
  private redis: any;

  constructor() {
    // Lazy require so this file doesn't crash if @upstash/redis isn't installed yet.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Redis } = require("@upstash/redis");
    this.redis = Redis.fromEnv();
  }

  async hasBeenSponsored(address: string): Promise<boolean> {
    const val = await this.redis.get(`sponsored:${address.toLowerCase()}`);
    return val !== null;
  }

  async markSponsored(address: string): Promise<void> {
    // No TTL: one-time-ever per address. Use `.set(key, 1, { ex: seconds })`
    // instead if you'd rather allow re-sponsorship after N days.
    await this.redis.set(`sponsored:${address.toLowerCase()}`, 1);
  }

  async getIpSponsorCount(ip: string): Promise<number> {
    const val = await this.redis.get(`ip-sponsor-count:${ip}`);
    return val ? Number(val) : 0;
  }

  async recordIpSponsorship(ip: string): Promise<void> {
    const key = `ip-sponsor-count:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, IP_WINDOW_SECONDS);
    }
  }
}

// ── Active store ─────────────────────────────────────────────────────────
// Switch this line to `new UpstashSponsorStore()` before deploying to
// production / mainnet.
export const sponsorStore: SponsorStore = new InMemorySponsorStore();

/** Max sponsorships allowed from a single IP within the rolling window. */
export const MAX_SPONSORSHIPS_PER_IP = 3;