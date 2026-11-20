import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitHub, GitHubError, RateLimitError, tokenFromEnv } from "../src/index.ts";
import { fakeApi, fakeClock, json } from "./helpers.ts";

const rl = (resource: string, remaining: number, reset: number, limit = resource === "search" ? 30 : 5000) => ({
  "x-ratelimit-resource": resource, "x-ratelimit-limit": String(limit),
  "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": String(reset),
});

describe("token", () => {
  test("GITHUB_TOKEN wins, GH_TOKEN is the fallback, blanks are ignored", () => {
    expect(tokenFromEnv({ GITHUB_TOKEN: "a", GH_TOKEN: "b" })).toBe("a");
    expect(tokenFromEnv({ GH_TOKEN: " b\n" })).toBe("b");
    expect(tokenFromEnv({ GITHUB_TOKEN: "  " })).toBeUndefined();
  });

  test("token is sent only as a bearer header", async () => {
    let seen: Record<string, string> = {};
    const gh = new GitHub({ token: "sekrit", fetch: async (_u, i) => { seen = i.headers; return json({}); } });
    await gh.get("/repos/a/b");
    expect(seen.Authorization).toBe("Bearer sekrit");
    expect(seen["User-Agent"]).toBe("gitforage");
  });
});

describe("rate limits", () => {
  test("tracks x-ratelimit-* headers per resource", async () => {
    const api = fakeApi([
      [/^\/search\//, () => json({ items: [] }, 200, rl("search", 29, 1000))],
      [/.*/, () => json({}, 200, rl("core", 4990, 2000))],
    ]);
    const gh = new GitHub({ token: "t", fetch: api.fetch });
    await gh.get("/search/repositories?q=x");
    await gh.get("/repos/a/b");
    expect(gh.buckets.search).toEqual({ limit: 30, remaining: 29, reset: 1000 });
    expect(gh.buckets.core).toEqual({ limit: 5000, remaining: 4990, reset: 2000 });
  });

  test("waits for the reset when a bucket is empty, before sending", async () => {
    const clock = fakeClock(1_000_000);
    const resetSec = 1_000_000 / 1000 + 30;
    const api = fakeApi([[/.*/, () => json({}, 200, rl("core", 0, resetSec))]]);
    const gh = new GitHub({ token: "t", fetch: api.fetch, ...clock });
    await gh.get("/repos/a/b");
    await gh.get("/repos/a/c");
    expect(clock.sleeps).toEqual([31_000]);
    expect(api.calls.length).toBe(2);
  });

  test("spaces search requests to the per-minute limit", async () => {
    const clock = fakeClock();
    const api = fakeApi([[/.*/, () => { clock.advance(100); return json({ items: [] }); }]]);
    const gh = new GitHub({ token: "t", fetch: api.fetch, searchPerMinute: 3, ...clock });
    for (let i = 0; i < 4; i++) await gh.get(`/search/repositories?q=${i}`);
    expect(clock.sleeps.length).toBe(1);
    expect(clock.sleeps[0]).toBeGreaterThan(59_000);
    // Core requests are not throttled by the search window.
    await gh.get("/repos/a/b");
    expect(clock.sleeps.length).toBe(1);
  });

  test("defaults to 10 searches a minute without a token", async () => {
    const clock = fakeClock();
    const gh = new GitHub({ fetch: fakeApi([[/.*/, () => json({ items: [] })]]).fetch, ...clock });
    for (let i = 0; i < 11; i++) await gh.get(`/search/repositories?q=${i}`);
    expect(clock.sleeps.length).toBe(1);
  });

  test("429 with retry-after: waits that long, then succeeds", async () => {
    const clock = fakeClock();
    let n = 0;
    const api = fakeApi([[/.*/, () => (n++ === 0 ? json({ message: "slow down" }, 429, { "retry-after": "7" }) : json({ ok: 1 }))]]);
    const gh = new GitHub({ fetch: api.fetch, ...clock });
    expect(await gh.get("/repos/a/b")).toEqual({ ok: 1 });
    expect(clock.sleeps).toEqual([7000]);
    expect(gh.stats).toMatchObject({ network: 2, retries: 1, waitedMs: 7000 });
  });

  test("403 with remaining=0: waits until x-ratelimit-reset", async () => {
    const clock = fakeClock(5_000_000);
    let n = 0;
    const api = fakeApi([[/.*/, () => n++ === 0
      ? json({ message: "API rate limit exceeded" }, 403, rl("core", 0, 5_000_000 / 1000 + 120))
      : json({ ok: 1 })]]);
    const gh = new GitHub({ fetch: api.fetch, ...clock });
    await gh.get("/repos/a/b");
    expect(clock.sleeps).toEqual([121_000]);
  });

  test("secondary rate limit: exponential backoff from 60s", async () => {
    const clock = fakeClock();
    let n = 0;
    const api = fakeApi([[/.*/, () => n++ < 2
      ? json({ message: "You have exceeded a secondary rate limit." }, 403)
      : json({ ok: 1 })]]);
    const gh = new GitHub({ fetch: api.fetch, ...clock });
    await gh.get("/repos/a/b");
    expect(clock.sleeps).toEqual([60_000, 120_000]);
  });

  test("a plain 403 (forbidden) is not retried", async () => {
    const clock = fakeClock();
    const api = fakeApi([[/.*/, () => json({ message: "Repository access blocked" }, 403)]]);
    const gh = new GitHub({ fetch: api.fetch, ...clock });
    await expect(gh.get("/repos/a/b")).rejects.toBeInstanceOf(GitHubError);
    expect(clock.sleeps).toEqual([]);
    expect(await gh.get("/repos/a/b", { allow: [403] })).toBeNull();
  });

  test("gives up with RateLimitError when the wait is over the cap", async () => {
    const clock = fakeClock();
    const api = fakeApi([[/.*/, () => json({ message: "x" }, 429, { "retry-after": "3600" })]]);
    const gh = new GitHub({ fetch: api.fetch, maxWaitMs: 60_000, ...clock });
    await expect(gh.get("/repos/a/b")).rejects.toBeInstanceOf(RateLimitError);
  });

  test("gives up after maxRetries", async () => {
    const clock = fakeClock();
    const api = fakeApi([[/.*/, () => json({ message: "x" }, 429, { "retry-after": "1" })]]);
    const gh = new GitHub({ fetch: api.fetch, maxRetries: 2, ...clock });
    await expect(gh.get("/repos/a/b")).rejects.toThrow("gave up after 3 attempts");
    expect(api.calls.length).toBe(3);
  });

  test("5xx retries with short backoff, then succeeds", async () => {
    const clock = fakeClock();
    let n = 0;
    const api = fakeApi([[/.*/, () => (n++ === 0 ? json({}, 502) : json({ ok: 1 }))]]);
    const gh = new GitHub({ fetch: api.fetch, ...clock });
    expect(await gh.get("/repos/a/b")).toEqual({ ok: 1 });
    expect(clock.sleeps).toEqual([2000]);
  });
});

describe("cache", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "gitforage-cache-"));

  test("second request is served from disk", async () => {
    const api = fakeApi([[/.*/, () => json({ v: 1 })]]);
    const d = dir();
    const a = new GitHub({ fetch: api.fetch, cacheDir: d });
    await a.get("/repos/a/b");
    const b = new GitHub({ fetch: api.fetch, cacheDir: d });
    expect(await b.get("/repos/a/b")).toEqual({ v: 1 });
    expect(api.calls.length).toBe(1);
    expect(b.stats).toMatchObject({ network: 0, cacheHits: 1 });
  });

  test("entries expire after the TTL", async () => {
    const clock = fakeClock();
    const api = fakeApi([[/.*/, () => json({ v: 1 })]]);
    const gh = new GitHub({ fetch: api.fetch, cacheDir: dir(), ttlMs: 1000, ...clock });
    await gh.get("/repos/a/b");
    clock.advance(1500);
    await gh.get("/repos/a/b");
    expect(api.calls.length).toBe(2);
  });

  test("allowed errors (404) are cached as null; real errors are not cached", async () => {
    const api = fakeApi([[/missing/, () => json({}, 404)], [/broken/, () => json({ message: "bad" }, 400)]]);
    const gh = new GitHub({ fetch: api.fetch, cacheDir: dir() });
    expect(await gh.get("/repos/a/missing", { allow: [404] })).toBeNull();
    expect(await gh.get("/repos/a/missing", { allow: [404] })).toBeNull();
    await expect(gh.get("/repos/a/broken")).rejects.toThrow("GitHub 400 on /repos/a/broken: bad");
    await expect(gh.get("/repos/a/broken")).rejects.toThrow();
    expect(api.calls.filter((c) => c.includes("missing")).length).toBe(1);
    expect(api.calls.filter((c) => c.includes("broken")).length).toBe(2);
  });

  test("cacheDir null disables caching", async () => {
    const api = fakeApi([[/.*/, () => json({ v: 1 })]]);
    const gh = new GitHub({ fetch: api.fetch, cacheDir: null });
    await gh.get("/repos/a/b");
    await gh.get("/repos/a/b");
    expect(api.calls.length).toBe(2);
  });
});
