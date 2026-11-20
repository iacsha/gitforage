import { describe, expect, test } from "bun:test";
import { rank, scoreCandidate, topReasons, withMode } from "../src/index.ts";
import { NOW, cand, cfg, daysAgo } from "./helpers.ts";

const reason = (s: ReturnType<typeof scoreCandidate>, rule: string) => s.reasons.find((r) => r.rule === rule);

describe("scoring", () => {
  test("score is the sum of reason points, and every reason has text", () => {
    const s = scoreCandidate(cand("a/b", { via_topics: ["hl7"] }, { topics: ["fhir"] }), cfg(), NOW);
    expect(s.score).toBeCloseTo(s.reasons.reduce((t, r) => t + r.points, 0), 5);
    for (const r of s.reasons) expect(r.text.length).toBeGreaterThan(0);
  });

  test("topic match counts repo topics and search hits, capped at 3", () => {
    const c = cfg({ topics: ["hl7", "fhir", "mirth", "dicom"] });
    const two = scoreCandidate(cand("a/b", { via_topics: ["hl7"] }, { topics: ["fhir", "HL7"] }), c, NOW);
    expect(reason(two, "topic_match")).toEqual({ rule: "topic_match", points: 6, text: "2 of your topics (fhir, hl7)" });
    const four = scoreCandidate(cand("a/b", {}, { topics: ["hl7", "fhir", "mirth", "dicom"] }), c, NOW);
    expect(reason(four, "topic_match")!.points).toBe(9);
  });

  test("keyword match reads name and description", () => {
    const s = scoreCandidate(cand("a/mllp-proxy", {}, { description: "tiny" }), cfg(), NOW);
    expect(reason(s, "keyword_match")).toMatchObject({ points: 2, text: 'matches "MLLP"' });
  });

  test("young repos score on stars a month, old ones on total stars", () => {
    const young = scoreCandidate(cand("a/new", {}, { stars: 120, created_at: daysAgo(90) }), cfg(), NOW);
    expect(reason(young, "star_velocity")!.text).toBe("~40 stars a month (new, 3 months ago)");
    expect(reason(young, "star_velocity")!.points).toBeCloseTo(3 * Math.log10(41), 1);
    const old = scoreCandidate(cand("a/old", {}, { stars: 999, created_at: daysAgo(900) }), cfg(), NOW);
    expect(reason(old, "stars")).toMatchObject({ points: 4.5, text: "999 stars" });
    expect(reason(old, "star_velocity")).toBeUndefined();
    // Capped: a viral or star-farmed repo cannot buy its way past fit.
    const viral = scoreCandidate(cand("a/viral", {}, { stars: 60_000, created_at: daysAgo(30) }), cfg(), NOW);
    expect(reason(viral, "star_velocity")!.points).toBe(7.5);
    const huge = scoreCandidate(cand("a/huge", {}, { stars: 500_000, created_at: daysAgo(3000) }), cfg(), NOW);
    expect(reason(huge, "stars")!.points).toBe(6);
  });

  test("push recency steps down, and a year of silence costs points", () => {
    const at = (d: number) => scoreCandidate(cand("a/b", {}, { pushed_at: daysAgo(d) }), cfg(), NOW);
    expect(reason(at(2), "recent_push")).toMatchObject({ points: 3, text: "pushed 2d ago" });
    expect(reason(at(20), "recent_push")!.points).toBe(2);
    expect(reason(at(60), "recent_push")!.points).toBe(1);
    expect(reason(at(200), "recent_push")).toBeUndefined();
    expect(reason(at(500), "stale_push")).toMatchObject({ points: -3, text: "no push since 17 months ago" });
  });

  test("contribute signals: outside PRs (capped at 5), CONTRIBUTING, starter issues, issue response", () => {
    const c = cfg({ mode: "contribute" });
    const s = scoreCandidate(cand("a/b", { signals: {
      outside_prs_90d: 7, contributing: true, good_first_issues: 10, help_wanted: 2, issue_response: { answered: 6, total: 8 },
    } }), c, NOW);
    expect(reason(s, "outside_prs")).toMatchObject({ points: 5, text: "merged 7 outside PRs in 90 days" });
    expect(reason(s, "contributing")!.text).toBe("has a CONTRIBUTING guide");
    expect(reason(s, "good_first_issue")!.text).toBe("10+ good first issues, 2 help wanted");
    expect(reason(s, "issue_response")).toMatchObject({ points: 2.3, text: "answered 6 of 8 recent issues" });
    // Too few issues to judge: no points either way.
    expect(reason(scoreCandidate(cand("a/b", { signals: { issue_response: { answered: 0, total: 2 } } }), c, NOW), "issue_response")).toBeUndefined();
    const none = scoreCandidate(cand("a/b", { signals: { outside_prs_90d: 0, contributing: false, good_first_issues: null } }), c, NOW);
    expect(["outside_prs", "contributing", "good_first_issue"].map((r) => reason(none, r))).toEqual([undefined, undefined, undefined]);
  });

  test("discover mode gives contributor signals no weight", () => {
    const s = scoreCandidate(cand("a/b", { signals: { outside_prs_90d: 7, contributing: true, good_first_issues: 3 } }), cfg(), NOW);
    expect(s.reasons.map((r) => r.rule)).not.toContain("outside_prs");
    expect(s.reasons.map((r) => r.rule)).not.toContain("good_first_issue");
  });

  test("releases: full points within 90 days, half within a year", () => {
    const at = (d: number) => scoreCandidate(cand("a/b", { signals: { latest_release: { tag: "v1.2.0", published_at: daysAgo(d) } } }), cfg(), NOW);
    expect(reason(at(5), "release")).toMatchObject({ points: 2, text: "released v1.2.0 5d ago" });
    expect(reason(at(200), "release")!.points).toBe(1);
    expect(reason(at(500), "release")).toBeUndefined();
  });

  test("readme quality: README, description, homepage, a third each", () => {
    const s = scoreCandidate(cand("a/b", { signals: { readme: true } }, { description: "A long enough description", homepage: "https://x.dev" }), cfg(), NOW);
    expect(reason(s, "readme")).toMatchObject({ points: 1.5, text: "docs: README, description, homepage" });
    const thin = scoreCandidate(cand("a/b", { signals: { readme: true } }), cfg(), NOW);
    expect(reason(thin, "readme")!.points).toBe(0.5);
    expect(reason(scoreCandidate(cand("a/b"), cfg(), NOW), "readme")).toBeUndefined();
  });

  test("license present adds a point; missing adds nothing", () => {
    expect(reason(scoreCandidate(cand("a/b"), cfg(), NOW), "license")!.text).toBe("MIT licensed");
    expect(reason(scoreCandidate(cand("a/b", {}, { license: null }), cfg(), NOW), "license")).toBeUndefined();
  });

  test("fork-ahead weight grows with log2 of commits ahead, capped", () => {
    const f = (ahead: number) => cand("x/engine", { sources: ["fork"], fork: { upstream: "acme/engine", ahead_by: ahead, behind_by: 4 } });
    const s7 = scoreCandidate(f(7), cfg({ mode: "contribute" }), NOW);
    expect(reason(s7, "fork_ahead")).toEqual({ rule: "fork_ahead", points: 6, text: "live fork of acme/engine: 7 commits ahead, 4 behind" });
    expect(reason(scoreCandidate(f(5000), cfg({ mode: "contribute" }), NOW), "fork_ahead")!.points).toBe(10);
    expect(reason(scoreCandidate(f(7), cfg(), NOW), "fork_ahead")!.points).toBe(3); // discover weighs forks lower
  });

  test("affinity scales with lift-weighted profile terms, capped at 3", () => {
    const s = scoreCandidate(cand("a/b", { sources: ["kin"], affinity: { shared: ["mllp", "hl7", "fhir", "dicom"], fit: 1.5 } }), cfg(), NOW);
    expect(reason(s, "affinity")).toMatchObject({ points: 3, text: "like your stars: mllp, hl7, fhir" });
    const big = scoreCandidate(cand("a/b", { affinity: { shared: ["x"], fit: 9 } }), cfg(), NOW);
    expect(reason(big, "affinity")!.points).toBe(6);
    expect(reason(scoreCandidate(cand("a/b"), cfg(), NOW), "affinity")).toBeUndefined();
  });

  test("weights override the mode preset, and 0 turns a rule off", () => {
    expect(withMode(cfg({ weights: { outside_prs: 4 } }), "contribute").weights).toMatchObject({ outside_prs: 4, issue_response: 3 });
    expect(withMode(cfg({ mode: "contribute" }), "discover").weights.outside_prs).toBe(0);
    const c = cfg({ weights: { topic_match: 10, license: 0 } });
    const s = scoreCandidate(cand("a/b", {}, { topics: ["hl7"] }), c, NOW);
    expect(reason(s, "topic_match")!.points).toBe(10);
    expect(reason(s, "license")).toBeUndefined();
  });

  test("rank sorts by score, then stars, then name; topReasons skips penalties", () => {
    const c = cfg();
    const items = [
      scoreCandidate(cand("z/low", {}, { license: null, pushed_at: daysAgo(500) }), c, NOW),
      scoreCandidate(cand("b/same"), c, NOW),
      scoreCandidate(cand("a/same"), c, NOW),
      scoreCandidate(cand("m/top", { via_topics: ["hl7", "fhir"] }), c, NOW),
    ];
    expect(rank(items).map((s) => s.candidate.repo.full_name)).toEqual(["m/top", "a/same", "b/same", "z/low"]);
    expect(topReasons(items[3]).some((t) => t.startsWith("no push"))).toBe(false);
    expect(topReasons(items[0])[0]).toBe("2 of your topics (hl7, fhir)");
  });
});
