import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitHub, emptyStars, forage, growthOf, isRising, loadStars, recordStars, risingQueries, saveStars, scoreCandidate,
} from "../src/index.ts";
import { NOW, cand, cfg, daysAgo, fakeApi, fakeClock, json, rawRepo, repo } from "./helpers.ts";

const DAY = 86_400_000;

describe("star observations", () => {
  test("growth needs a baseline at least 3 days old", () => {
    const s = emptyStars();
    s.repos["a/b"] = { stars: 900, at: daysAgo(7) };
    expect(growthOf(repo("A/b", { stars: 1000 }), s, NOW)).toEqual({ delta: 100, days: 7, per_month: 428.6 });
    s.repos["a/b"] = { stars: 900, at: daysAgo(1) };
    expect(growthOf(repo("a/b", { stars: 1000 }), s, NOW)).toBeNull();
    expect(growthOf(repo("x/y"), s, NOW)).toBeNull();
  });

  test("a same-week rerun keeps the old baseline; a later one replaces it; stale entries are pruned", () => {
    const s = emptyStars();
    s.repos["a/b"] = { stars: 900, at: daysAgo(3) };
    s.repos["old/gone"] = { stars: 5, at: daysAgo(200) };
    recordStars(s, [repo("a/b", { stars: 1000 }), repo("new/one", { stars: 7 })], NOW);
    expect(s.repos["a/b"]).toEqual({ stars: 900, at: daysAgo(3) });
    expect(s.repos["new/one"]).toEqual({ stars: 7, at: new Date(NOW).toISOString() });
    expect(s.repos["old/gone"]).toBeUndefined();
    recordStars(s, [repo("a/b", { stars: 1100 })], NOW + 4 * DAY);
    expect(s.repos["a/b"].stars).toBe(1100);
  });

  test("load validates every entry; save is sorted and round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-stars-"));
    const p = join(dir, "stars.json");
    expect(loadStars(p)).toEqual(emptyStars());
    writeFileSync(p, JSON.stringify({ version: 1, repos: {
      "b/b": { stars: 3, at: daysAgo(1) }, "../etc": { stars: 1, at: daysAgo(1) }, "a/a": { stars: "x", at: daysAgo(1) },
      "c/c": { stars: 4, at: "not a date" }, "d/d": { stars: -1, at: daysAgo(1) }, "A/Z": { stars: 2.7, at: daysAgo(2) },
    } }));
    const s = loadStars(p);
    expect(Object.keys(s.repos).sort()).toEqual(["a/z", "b/b"]);
    expect(s.repos["a/z"].stars).toBe(2);
    saveStars(p, s);
    expect(Object.keys(JSON.parse(readFileSync(p, "utf8")).repos)).toEqual(["a/z", "b/b"]);
    writeFileSync(p, JSON.stringify({ version: 2, repos: {} }));
    expect(() => loadStars(p)).toThrow("not a gitforage stars file");
  });

  test("rising needs real growth: absolute and relative", () => {
    expect(isRising(30, 1000, 10)).toBe(true);
    expect(isRising(5, 100, 10)).toBe(false);
    expect(isRising(50, 20_000, 10)).toBe(false); // 50 a month is nothing for a 20k-star repo
  });
});

describe("rising source", () => {
  test("queries look for older, recently pushed repos", () => {
    const q = risingQueries(cfg({ filters: { max_age_days: 365, min_stars: 5 } }), NOW);
    expect(q[0]).toEqual({ kind: "topic", term: "hl7", q: "topic:hl7 created:<2025-11-20 pushed:>=2026-10-21 stars:>=50 archived:false" });
    expect(q.at(-1)!.q).toStartWith('"MLLP" in:name,description created:<2025-11-20');
  });

  const world = () => fakeApi([
    [/^\/search\/repositories\?q=topic:hl7 created:</, () => json({ items: [
      rawRepo("old/climber", { topics: ["hl7"], created_at: daysAgo(900), stargazers_count: 1000 }),
      rawRepo("old/flat", { topics: ["hl7"], created_at: daysAgo(900), stargazers_count: 1000 }),
    ] })],
    [/^\/search\/repositories/, () => json({ items: [] })],
  ]);
  const c = () => cfg({ topics: ["hl7"], keywords: [], seeds: [], limits: { signals_top: 0 } });

  test("first run records a baseline and finds nothing; the next run finds the climber", async () => {
    const stars = emptyStars();
    const first = await forage(c(), new GitHub({ fetch: world().fetch, ...fakeClock() }), { now: NOW - 7 * DAY, stars });
    expect(first.found.rising).toBe(0);
    expect(stars.repos["old/climber"].stars).toBe(1000);
    stars.repos["old/climber"].stars = 880; // as it was a week ago
    stars.repos["old/flat"].stars = 999;

    const res = await forage(c(), new GitHub({ fetch: world().fetch, ...fakeClock() }), { now: NOW, stars });
    expect(res.found.rising).toBe(1);
    const top = res.ranked[0];
    expect(top.candidate.repo.full_name).toBe("old/climber");
    expect(top.candidate.sources).toEqual(["rising"]);
    expect(top.candidate.via_topics).toEqual(["hl7"]);
    expect(top.reasons.find((r) => r.rule === "star_growth")!.text).toBe("+120 stars in 7d (~514 a month)");
    expect(res.ranked.map((s) => s.candidate.repo.full_name)).not.toContain("old/flat");
    // The baseline was a week old, so this run replaced it.
    expect(stars.repos["old/climber"]).toEqual({ stars: 1000, at: new Date(NOW).toISOString() });
  });

  test("star_growth applies only to older repos, capped", () => {
    const young = cand("a/b", { growth: { delta: 50, days: 7, per_month: 214 } }, { created_at: daysAgo(30) });
    expect(scoreCandidate(young, cfg(), NOW).reasons.some((r) => r.rule === "star_growth")).toBe(false);
    const old = cand("a/b", { growth: { delta: 9000, days: 7, per_month: 38_571 } }, { created_at: daysAgo(900) });
    expect(scoreCandidate(old, cfg(), NOW).reasons.find((r) => r.rule === "star_growth")!.points).toBe(5);
    const shrinking = cand("a/b", { growth: { delta: -5, days: 7, per_month: -21 } }, { created_at: daysAgo(900) });
    expect(scoreCandidate(shrinking, cfg(), NOW).reasons.some((r) => r.rule === "star_growth")).toBe(false);
  });

  test("rising_per_query 0 turns the source off", async () => {
    const api = world();
    const cc = c();
    cc.limits.rising_per_query = 0;
    await forage(cc, new GitHub({ fetch: api.fetch, ...fakeClock() }), { now: NOW });
    expect(api.calls.some((x) => x.includes("created:<"))).toBe(false);
  });
});
