// Minimal GitHub REST client: plain fetch, on-disk cache, rate-limit tracking and backoff.
//
// - Tracks x-ratelimit-* per resource (core, search) and waits for the reset when a
//   bucket is empty instead of burning requests on 403s.
// - Spaces search requests to stay under the search limit (30 a minute with a token).
// - Backs off on 403/429: honours retry-after, then the reset time, then falls back to
//   exponential backoff for secondary limits, as GitHub's docs ask.
// - Caches successful (and expected-error) responses on disk with a TTL, so reruns are cheap.
// The token goes only into the Authorization header. It is never logged or cached.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export interface ClientOptions {
  token?: string;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Directory for cached responses; null disables the cache. */
  cacheDir?: string | null;
  ttlMs?: number;
  /** Longest single wait before giving up with RateLimitError (default 15 minutes). */
  maxWaitMs?: number;
  maxRetries?: number;
  /** Search requests allowed per rolling minute (default 30 with a token, 10 without). */
  searchPerMinute?: number;
  log?: (msg: string) => void;
  baseUrl?: string;
  userAgent?: string;
  /** Largest response body accepted, in bytes (default 8 MB). Bigger bodies are an error. */
  maxBodyBytes?: number;
}

export interface RateBucket { limit: number; remaining: number; reset: number }

export interface ClientStats {
  /** Requests that went to the network, including retries. */
  network: number;
  cacheHits: number;
  retries: number;
  waitedMs: number;
}

export class GitHubError extends Error {
  constructor(public readonly status: number, public readonly path: string, detail: string) {
    super(`GitHub ${status} on ${path}${detail ? `: ${detail}` : ""}`);
    this.name = "GitHubError";
  }
}

export class RateLimitError extends Error {
  constructor(public readonly path: string, public readonly waitMs: number) {
    super(`rate limited on ${path}; the next window is ${Math.ceil(waitMs / 1000)}s away, over the wait cap. Try again later or set GITHUB_TOKEN.`);
    this.name = "RateLimitError";
  }
}

interface CacheEntry { url: string; at: number; status: number; body: unknown }

export interface GetOptions {
  /** Statuses returned as `null` instead of thrown (and cached), e.g. [404]. */
  allow?: number[];
  /** Cache lifetime for this request, overriding the client's ttlMs (for slow-changing data such as topic counts). */
  ttlMs?: number;
}

export function tokenFromEnv(env: Record<string, string | undefined> = process.env): string | undefined {
  const t = (env.GITHUB_TOKEN || env.GH_TOKEN || "").trim();
  return t || undefined;
}

export class GitHub {
  readonly stats: ClientStats = { network: 0, cacheHits: 0, retries: 0, waitedMs: 0 };
  readonly buckets: Record<string, RateBucket> = {};
  private searchTimes: number[] = [];
  private readonly o: Required<Omit<ClientOptions, "token" | "cacheDir">> & { cacheDir: string | null };
  private readonly headers: Record<string, string>;
  private readonly token: string;

  constructor(opts: ClientOptions = {}) {
    this.o = {
      fetch: opts.fetch ?? ((u, i) => fetch(u, i)),
      sleep: opts.sleep ?? ((ms) => Bun.sleep(ms)),
      now: opts.now ?? Date.now,
      cacheDir: opts.cacheDir ?? null,
      ttlMs: opts.ttlMs ?? 12 * 3_600_000,
      maxWaitMs: opts.maxWaitMs ?? 15 * 60_000,
      maxRetries: opts.maxRetries ?? 5,
      searchPerMinute: opts.searchPerMinute ?? (opts.token ? 30 : 10),
      log: opts.log ?? (() => {}),
      baseUrl: opts.baseUrl ?? "https://api.github.com",
      userAgent: opts.userAgent ?? "gitforage",
      maxBodyBytes: opts.maxBodyBytes ?? 8 * 1024 * 1024,
    };
    this.token = opts.token ?? "";
    const log = this.o.log;
    this.o.log = (m) => log(this.redact(m));
    this.headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": this.o.userAgent,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    };
  }

  static resourceFor(path: string): "search" | "core" {
    return path.startsWith("/search/") ? "search" : "core";
  }

  /** GET a JSON resource. Returns null for statuses listed in `allow`. */
  async get<T = any>(path: string, opts: GetOptions = {}): Promise<T | null> {
    const url = this.o.baseUrl + path;
    const cached = this.readCache(url, opts.ttlMs ?? this.o.ttlMs);
    if (cached) {
      this.stats.cacheHits++;
      return cached.status >= 400 ? null : (cached.body as T);
    }

    const resource = GitHub.resourceFor(path);
    let backoff = 0;
    for (let attempt = 0; ; attempt++) {
      await this.beforeRequest(resource, path);
      this.stats.network++;
      const res = await this.o.fetch(url, { headers: this.headers });
      this.trackHeaders(res.headers, resource);

      if (res.ok) {
        const text = res.status === 204 ? "" : await readCapped(res, this.o.maxBodyBytes, path);
        let body: unknown = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            throw new GitHubError(res.status, path, "response is not JSON");
          }
        }
        this.writeCache({ url, at: this.o.now(), status: res.status, body });
        return body as T;
      }

      const text = await readCapped(res, 64 * 1024, path).catch(() => "");
      const wait = this.retryDelay(res, text, backoff);
      if (wait !== null) {
        if (attempt >= this.o.maxRetries) throw new GitHubError(res.status, path, `gave up after ${attempt + 1} attempts`);
        if (wait > this.o.maxWaitMs) throw new RateLimitError(path, wait);
        backoff++;
        this.stats.retries++;
        this.o.log(`GitHub ${res.status} on ${path}, waiting ${Math.ceil(wait / 1000)}s`);
        await this.pause(wait);
        continue;
      }

      if (opts.allow?.includes(res.status)) {
        this.writeCache({ url, at: this.o.now(), status: res.status, body: null });
        return null;
      }
      throw new GitHubError(res.status, path, this.redact(messageOf(text)));
    }
  }

  /** Remove the token from any text that might be shown or logged. */
  redact(text: string): string {
    return this.token ? text.split(this.token).join("[REDACTED]") : text;
  }

  /**
   * How long to wait before retrying, or null when the response is not retryable.
   * Order: retry-after header, empty primary bucket (wait for reset), secondary limit
   * (exponential from 60s), server errors (exponential from 2s, at most 3 tries).
   */
  retryDelay(res: Response, bodyText: string, backoff: number): number | null {
    const s = res.status;
    if (s === 403 || s === 429) {
      const retryAfter = Number(res.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
      if (res.headers.get("x-ratelimit-remaining") === "0") {
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
        return Math.max(reset - this.o.now(), 0) + 1000;
      }
      if (s === 429 || /secondary rate limit|abuse/i.test(bodyText)) return 60_000 * 2 ** backoff;
      return null; // a real 403 (forbidden, blocked repo): not a rate limit
    }
    if (s >= 500 && s <= 599 && backoff < 3) return 2_000 * 2 ** backoff;
    return null;
  }

  private async beforeRequest(resource: string, path: string) {
    // Primary bucket empty: wait for its reset rather than collect a 403.
    const b = this.buckets[resource];
    if (b && b.remaining <= 0) {
      const wait = b.reset * 1000 - this.o.now() + 1000;
      if (wait > 0) {
        if (wait > this.o.maxWaitMs) throw new RateLimitError(path, wait);
        this.o.log(`${resource} rate limit used up, waiting ${Math.ceil(wait / 1000)}s for reset`);
        await this.pause(wait);
      }
      b.remaining = b.limit; // optimistic; the next response corrects it
    }
    if (resource === "search") {
      const now = this.o.now();
      this.searchTimes = this.searchTimes.filter((t) => now - t < 60_000);
      if (this.searchTimes.length >= this.o.searchPerMinute) {
        const wait = 60_000 - (now - this.searchTimes[0]) + 250;
        this.o.log(`search limit (${this.o.searchPerMinute}/min) reached, waiting ${Math.ceil(wait / 1000)}s`);
        await this.pause(wait);
        const after = this.o.now();
        this.searchTimes = this.searchTimes.filter((t) => after - t < 60_000);
      }
      this.searchTimes.push(this.o.now());
    }
  }

  private trackHeaders(h: Headers, fallback: string) {
    const remaining = h.get("x-ratelimit-remaining");
    if (remaining === null) return;
    const resource = h.get("x-ratelimit-resource") ?? fallback;
    this.buckets[resource] = {
      limit: Number(h.get("x-ratelimit-limit") ?? 0),
      remaining: Number(remaining),
      reset: Number(h.get("x-ratelimit-reset") ?? 0),
    };
  }

  private async pause(ms: number) {
    this.stats.waitedMs += ms;
    await this.o.sleep(ms);
  }

  private cachePath(url: string): string | null {
    if (!this.o.cacheDir) return null;
    const h = createHash("sha256").update(url).digest("hex");
    return join(this.o.cacheDir, h.slice(0, 2), `${h}.json`);
  }

  private readCache(url: string, ttlMs: number): CacheEntry | null {
    const p = this.cachePath(url);
    if (!p || this.o.ttlMs <= 0 || ttlMs <= 0) return null;
    try {
      const e = JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
      if (e.url !== url || this.o.now() - e.at > ttlMs) return null;
      return e;
    } catch {
      return null; // missing or unreadable cache file: fetch fresh
    }
  }

  private writeCache(e: CacheEntry) {
    const p = this.cachePath(e.url);
    if (!p || this.o.ttlMs <= 0) return;
    try {
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, JSON.stringify(e));
    } catch (err) {
      this.o.log(`cache write failed (${(err as Error).message}); continuing without it`);
    }
  }
}

/** Read a body as text, refusing anything over maxBytes (checked on the header and while streaming). */
export async function readCapped(res: Response, maxBytes: number, path: string): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new GitHubError(res.status, path, `response too large (${declared} bytes, limit ${maxBytes})`);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new GitHubError(res.status, path, `response too large (over ${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function messageOf(text: string): string {
  try {
    return String(JSON.parse(text).message ?? "").slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}
