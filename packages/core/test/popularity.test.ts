import { describe, expect, test } from "bun:test";
import { ALL, assignPopularity, groupsOf, midRanks, rank, scoreCandidate } from "../src/index.ts";
import { NOW, cand, cfg, daysAgo } from "./helpers.ts";

describe("popularity within topic", () => {
  test("mid-rank percentiles", () => {
    expect(midRanks([10])).toEqual([0.5]);
    expect(midRanks([1, 2, 3, 4])).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(midRanks([5, 5])).toEqual([0.5, 0.5]);
  });

  test("groups: interest topics and keywords, else the strongest profile term, else the whole run", () => {
    const c = cfg({ topics: ["hl7", "fhir"], keywords: ["MLLP"] });
    expect(groupsOf(cand("a/mllp-x", { via_topics: ["fhir"] }, { topics: ["hl7"] }), c).sort()).toEqual(["MLLP", "fhir", "hl7"]);
    expect(groupsOf(cand("a/b", { affinity: { shared: ["dicom", "pacs"], fit: 1 } }), c)).toEqual(["dicom"]);
    expect(groupsOf(cand("a/b"), c)).toEqual([ALL]);
  });

  test("a 50-star HL7 repo outranks a 5,000-star generic one when its fit is higher", () => {
    const c = cfg({ topics: ["hl7", "cli"], keywords: [] });
    const old = { created_at: daysAgo(900) };
    const pool = [
      cand("niche/hl7-top", { via_topics: ["hl7"] }, { ...old, stars: 50, topics: ["hl7", "mllp"] }),
      cand("niche/hl7-low", { via_topics: ["hl7"] }, { ...old, stars: 8, topics: ["hl7"] }),
      cand("big/cli-top", { via_topics: ["cli"] }, { ...old, stars: 5000, topics: ["cli"] }),
      cand("big/cli-low", { via_topics: ["cli"] }, { ...old, stars: 900, topics: ["cli"] }),
    ];
    assignPopularity(pool, c, NOW);
    expect(pool[0].popularity).toMatchObject({ basis: "stars", group: "hl7", pct: 0.75, n: 2 });
    expect(pool[2].popularity!.pct).toBe(0.75);
    const scored = rank(pool.map((p) => scoreCandidate(p, c, NOW)));
    const stars = (s: (typeof scored)[0]) => s.reasons.find((r) => r.rule === "stars")!;
    expect(stars(scored.find((s) => s.candidate.repo.full_name === "niche/hl7-top")!))
      .toEqual({ rule: "stars", points: 4.5, text: "50 stars, top 25% in hl7" });
    expect(stars(scored.find((s) => s.candidate.repo.full_name === "big/cli-top")!).points).toBe(4.5);
    // Equal popularity, so the extra fit (affinity) decides.
    pool[0].affinity = { shared: ["mllp", "hl7"], fit: 1.8 };
    const again = rank(pool.map((p) => scoreCandidate(p, c, NOW)));
    expect(again[0].candidate.repo.full_name).toBe("niche/hl7-top");

    // popularity: global goes back to raw log-scaled counts, where the big repo wins on stars.
    const g = cfg({ topics: ["hl7", "cli"], keywords: [], popularity: "global" });
    const big = scoreCandidate(pool[2], g, NOW).reasons.find((r) => r.rule === "stars")!;
    const small = scoreCandidate(pool[0], g, NOW).reasons.find((r) => r.rule === "stars")!;
    expect(big.points).toBeGreaterThan(small.points);
    expect(big.text).toBe("5000 stars");
  });

  test("young repos are compared on stars a month, only with other young repos", () => {
    const c = cfg({ topics: ["hl7"], keywords: [] });
    const pool = [
      cand("a/young", { via_topics: ["hl7"] }, { created_at: daysAgo(30), stars: 60 }),
      cand("a/old", { via_topics: ["hl7"] }, { created_at: daysAgo(900), stars: 10 }),
    ];
    assignPopularity(pool, c, NOW);
    expect(pool[0].popularity).toMatchObject({ basis: "velocity", value: 60, n: 1, pct: 0.5 });
    expect(pool[1].popularity).toMatchObject({ basis: "stars", n: 1 });
    expect(scoreCandidate(pool[0], c, NOW).reasons.find((r) => r.rule === "star_velocity")!.text)
      .toBe("~60 stars a month (new, 30d ago, top 50% in hl7)");
  });

  test("config: popularity must be topic or global", () => {
    expect(cfg().popularity).toBe("topic");
    expect(() => cfg({ popularity: "stars" })).toThrow("popularity: must be topic or global");
  });
});
