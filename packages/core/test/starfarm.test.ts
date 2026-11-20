import { describe, expect, test } from "bun:test";
import { exclusionReason } from "../src/exclude.ts";
import { forage } from "../src/forage.ts";
import { GitHub } from "../src/github.ts";
import { scoreCandidate } from "../src/scoring.ts";
import { starFarmCheck, starFarmText } from "../src/starfarm.ts";
import { toRepo, type Candidate } from "../src/types.ts";
import { cand, cfg, daysAgo, fakeApi, json, NOW, rawRepo } from "./helpers.ts";

/** Shapes taken from real repos on 2026-11-20 (rounded). */
const SHAPES = {
  // morluto/rea: ~470k stars in 7 months. Forks and issues look busy; the velocity does not.
  rea: { stars: 470_375, forks: 114_895, open_issues: 1350, size_kb: 197_571, created_at: daysAgo(220) },
  // A classic bought-stars repo: lots of stars, almost nobody forking or contributing.
  farm: { stars: 470_000, forks: 12, open_issues: 0, size_kb: 90, created_at: daysAgo(210) },
  smallFarm: { stars: 5200, forks: 9, open_issues: 1, size_kb: 600, created_at: daysAgo(120) },
  // Real, popular repos that must not be flagged.
  ghCli: { stars: 47_099, forks: 9430, open_issues: 900, size_kb: 40_000, created_at: daysAgo(2600) },
  immich: { stars: 119_712, forks: 7665, open_issues: 300, size_kb: 300_000, created_at: daysAgo(1750) },
  claudeCode: { stars: 156_405, forks: 25_062, open_issues: 5000, size_kb: 20_000, created_at: daysAgo(636) },
  paperclip: { stars: 115_362, forks: 19_151, open_issues: 6948, size_kb: 566_142, created_at: daysAgo(263) },
  // gathin23/cleanyourtv: ~60k stars in 34 days, but 7.8k forks and busy issues.
  viralMonth: { stars: 59_655, forks: 7808, open_issues: 178, size_kb: 9000, created_at: daysAgo(34) },
  // deepseek-ai/deepseek-harness: ~284k stars in 3 months and no open issues.
  harness: { stars: 284_365, forks: 35_334, open_issues: 0, size_kb: 30_000, created_at: daysAgo(99) },
  viralYoung: { stars: 6066, forks: 1130, open_issues: 1, size_kb: 1962, created_at: daysAgo(17) },
  small: { stars: 300, forks: 1, open_issues: 0, size_kb: 10, created_at: daysAgo(30) },
};
const c = (shape: keyof typeof SHAPES, o: Partial<Candidate> = {}) => cand(`x/${shape}`, o, SHAPES[shape]);

describe("starFarmCheck", () => {
  test("flags the morluto/rea shape on velocity alone", () => {
    const check = starFarmCheck(c("rea"), NOW)!;
    expect(check).not.toBeNull();
    expect(check.strong).toBeGreaterThanOrEqual(1);
    expect(starFarmText(c("rea"), check)).toBe("stars look inflated: 470k stars in 7 months");
  });

  test("more stars than nearly any repo ever, in under a year, is enough", () => {
    expect(starFarmText(c("harness"), starFarmCheck(c("harness"), NOW)!)).toBe("stars look inflated: 284k stars in 3 months, 0 open issues");
  });

  test("flags stars far above forks and contributors, and says why", () => {
    const farm = c("farm", { signals: { contributors: 1 } });
    const check = starFarmCheck(farm, NOW)!;
    expect(starFarmText(farm, check)).toBe("stars look inflated: 470k stars in 7 months, 12 forks, 0 open issues, 1 contributor, 90 KB of code");
    const small = c("smallFarm");
    expect(starFarmText(small, starFarmCheck(small, NOW)!)).toBe("stars look inflated: 5.2k stars, 9 forks, 1 open issue");
  });

  test("leaves real popular repos alone", () => {
    for (const s of ["ghCli", "immich", "claudeCode", "paperclip", "viralMonth", "viralYoung", "small"] as const) {
      expect([s, starFarmCheck(c(s), NOW)]).toEqual([s, null]);
    }
  });

  test("one weak signal is not enough; a contributor count can tip it", () => {
    const lone = cand("x/lone", {}, { stars: 3000, forks: 60, open_issues: 40, size_kb: 5000, created_at: daysAgo(300) });
    expect(starFarmCheck(lone, NOW)).toBeNull();
    expect(starFarmCheck({ ...lone, signals: { contributors: 1 } }, NOW)?.evidence).toEqual(["60 forks", "1 contributor"]);
  });

  test("a sudden spike far above the lifetime average is a weak signal", () => {
    const spike = cand("x/spike", { growth: { delta: 9000, days: 7, per_month: 38_571 }, signals: { contributors: 2 } },
      { stars: 12_000, forks: 900, open_issues: 30, size_kb: 4000, created_at: daysAgo(900) });
    expect(starFarmCheck(spike, NOW)?.evidence).toEqual(["2 contributors", "+9k in 7d"]);
  });

  test("forks and repos without the counts are never flagged by them", () => {
    expect(starFarmCheck(c("farm", { sources: ["fork"] }), NOW)).toBeNull();
    expect(starFarmCheck(cand("x/nocounts", {}, { stars: 4000, created_at: daysAgo(300) }), NOW)).toBeNull();
  });

  test("toRepo reads the counts from the payload, and leaves them out when absent", () => {
    const r = toRepo(rawRepo("a/b", { forks_count: 12, open_issues_count: 3, size: 90 }))!;
    expect([r.forks, r.open_issues, r.size_kb]).toEqual([12, 3, 90]);
    const bare = toRepo(rawRepo("a/b", { forks_count: "lots" }))!;
    expect("forks" in bare || "open_issues" in bare || "size_kb" in bare).toBe(false);
  });
});

describe("the star-farm penalty and filter", () => {
  test("a flagged repo loses points with a visible reason", () => {
    const x = c("rea");
    x.star_farm = starFarmCheck(x, NOW)!;
    const s = scoreCandidate(x, cfg(), NOW);
    expect(s.reasons).toContainEqual({ rule: "star_farm", points: -8, text: "stars look inflated: 470k stars in 7 months" });
    expect(scoreCandidate(x, cfg({ weights: { star_farm: 0 } }), NOW).reasons.some((r) => r.rule === "star_farm")).toBe(false);
  });

  test("drop_suspected_star_farms drops it with the reason", () => {
    const x = c("rea");
    x.star_farm = starFarmCheck(x, NOW)!;
    expect(exclusionReason(x, cfg(), new Set())).toBeNull();
    expect(exclusionReason(x, cfg({ filters: { drop_suspected_star_farms: true } }), new Set())).toBe("stars look inflated: 470k stars in 7 months");
  });

  test("forage flags from the payload, asks for contributors only for big unflagged top repos, and drops when asked", async () => {
    const young = "2026-05-01T00:00:00Z";
    const items = [
      rawRepo("x/rea", { topics: ["hl7"], stargazers_count: 470_000, forks_count: 114_000, open_issues_count: 1300, size: 197_000, created_at: daysAgo(220) }),
      rawRepo("x/solo", { topics: ["hl7"], stargazers_count: 3000, forks_count: 70, open_issues_count: 40, size: 5000, created_at: young }),
      rawRepo("x/real", { topics: ["hl7"], stargazers_count: 3000, forks_count: 400, open_issues_count: 40, size: 5000, created_at: young }),
      rawRepo("x/tiny", { topics: ["hl7"], stargazers_count: 40, forks_count: 2, open_issues_count: 1, size: 50, created_at: young }),
    ];
    const api = fakeApi([
      [/^\/search\/repositories/, () => json({ items })],
      [/^\/repos\/x\/solo\/contributors/, () => json([{ login: "one" }])],
      [/^\/repos\/x\/real\/contributors/, () => json(Array.from({ length: 30 }, (_, i) => ({ login: `u${i}` })))],
    ]);
    const gh = new GitHub({ fetch: api.fetch as any, cacheDir: null, sleep: async () => {}, now: () => NOW });
    const base = { seeds: [], keywords: [], topics: ["hl7"], limits: { kin_terms: 0, rising_per_query: 0 } };
    const res = await forage(cfg(base), gh, { now: NOW });
    const byName = new Map(res.ranked.map((s) => [s.candidate.repo.full_name, s]));
    expect(byName.get("x/rea")!.reasons.find((r) => r.rule === "star_farm")?.text).toBe("stars look inflated: 470k stars in 7 months");
    expect(byName.get("x/solo")!.reasons.find((r) => r.rule === "star_farm")?.text).toBe("stars look inflated: 3k stars, 70 forks, 1 contributor");
    expect(byName.get("x/real")!.reasons.some((r) => r.rule === "star_farm")).toBe(false);
    const contributorCalls = api.calls.filter((u) => u.includes("/contributors"));
    expect(contributorCalls.sort()).toEqual(["/repos/x/real/contributors?per_page=100", "/repos/x/solo/contributors?per_page=100"]);

    const dropped = await forage(cfg({ ...base, filters: { drop_suspected_star_farms: true } }), new GitHub({ fetch: api.fetch as any, cacheDir: null, sleep: async () => {}, now: () => NOW }), { now: NOW });
    expect(dropped.ranked.map((s) => s.candidate.repo.full_name).sort()).toEqual(["x/real", "x/tiny"]);
    expect(dropped.excluded).toContainEqual({ full_name: "x/rea", reason: "stars look inflated: 470k stars in 7 months" });
    expect(dropped.excluded).toContainEqual({ full_name: "x/solo", reason: "stars look inflated: 3k stars, 70 forks, 1 contributor" });
  });
});
