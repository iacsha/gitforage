import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONTRIBUTE_WEIGHTS, ConfigError, DEFAULT_LIMITS, DEFAULT_WEIGHTS, parseConfig, validateConfig } from "../src/index.ts";

const problems = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { if (e instanceof ConfigError) return e.problems; throw e; }
  throw new Error("expected a ConfigError");
};

describe("config", () => {
  test("the documented example parses with defaults filled in", () => {
    const c = parseConfig(`
profile: |
  Healthcare integration engineer.
topics: [hl7, fhir, mirth, zigbee, home-assistant, home-automation]
keywords: ["HL7 v2", "MLLP", "Zigbee2MQTT", "Matter bridge"]
seeds:
  - nextgenhealthcare/connect
  - OpenIntegrationEngine/engine
stars_from: octocat
exclude:
  topics: [awesome-list]
  keywords: ["pirate", "free followers"]
  owners: []
filters:
  min_stars: 5
  max_age_days: 365
  languages: []
cadence: weekly
digest_size: 20
llm:
  provider: none
  model: ""
`);
    expect(c.topics).toContain("home-automation");
    expect(c.seeds).toEqual(["nextgenhealthcare/connect", "OpenIntegrationEngine/engine"]);
    expect(c.stars_from).toBe("octocat");
    expect(c.weights).toEqual(DEFAULT_WEIGHTS);
    expect(c.limits).toEqual(DEFAULT_LIMITS);
    expect(c.cache.ttl_hours).toBe(12);
  });

  test("the shipped example files are valid", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    for (const f of ["interests.example.yml", "demo/interests.yml"]) {
      expect(() => parseConfig(readFileSync(join(root, f), "utf8"), f)).not.toThrow();
    }
  });

  test("the commented exclude.patterns example is valid once uncommented, and off by default", () => {
    const text = readFileSync(join(import.meta.dir, "..", "..", "..", "interests.example.yml"), "utf8");
    expect(parseConfig(text).exclude.patterns).toEqual([]);
    const on = text.replace("  patterns: []\n  # patterns:", "  patterns:").replace(/^  # {3}/gm, "    ");
    const pats = parseConfig(on).exclude.patterns;
    expect(pats.map((x) => x.kind)).toEqual(["keyword", "keyword", "keyword", "regex", "regex"]);
    expect(pats[3].test("Weekly crypto airdrops")).toBe(true);
    expect(pats[3].test("A crypto library")).toBe(false);
  });

  test("minimal config: one seed is enough", () => {
    const c = validateConfig({ seeds: ["a/b"] });
    expect(c.cadence).toBe("weekly");
    expect(c.digest_size).toBe(20);
    expect(c.filters.min_stars).toBe(5);
  });

  test("topics are lowercased and deduped; exclude keywords lowercased", () => {
    const c = validateConfig({ topics: ["HL7", "hl7"], exclude: { keywords: ["Pirate"] } });
    expect(c.topics).toEqual(["hl7"]);
    expect(c.exclude.keywords).toEqual(["pirate"]);
  });

  test("empty config is rejected with a clear message", () => {
    expect(problems(() => validateConfig({}))[0]).toContain("nothing to forage");
    expect(problems(() => validateConfig(null))[0]).toContain("YAML mapping");
  });

  test("every problem is reported at once, with paths", () => {
    const p = problems(() => validateConfig({
      topics: ["Not A Topic!"], seeds: ["noslash"], cadence: "hourly", digest_size: 0,
      filters: { min_stars: "five" }, llm: { provider: "gpt" },
    }));
    expect(p).toContainEqual(expect.stringContaining("topics[0]"));
    expect(p).toContainEqual(expect.stringContaining("seeds[0]: \"noslash\" must look like owner/repo"));
    expect(p).toContainEqual(expect.stringContaining("cadence: must be one of daily, weekly, monthly"));
    expect(p).toContainEqual(expect.stringContaining("digest_size: must be between 1 and 200"));
    expect(p).toContainEqual(expect.stringContaining("filters.min_stars: must be a whole number"));
    expect(p).toContainEqual(expect.stringContaining("llm.provider"));
  });

  test("unknown keys get a did-you-mean hint", () => {
    const p = problems(() => validateConfig({ topcs: ["hl7"], seeds: ["a/b"], filters: { min_star: 3 } }));
    expect(p).toContainEqual('topcs: unknown key (did you mean "topics"?)');
    expect(p).toContainEqual('filters.min_star: unknown key (did you mean "min_stars"?)');
  });

  test("weights and limits can be overridden and are checked", () => {
    const c = validateConfig({ seeds: ["a/b"], weights: { fork_ahead: 5 }, limits: { signals_top: 3 } });
    expect(c.weights.fork_ahead).toBe(5);
    expect(c.weights.topic_match).toBe(DEFAULT_WEIGHTS.topic_match);
    expect(c.limits.signals_top).toBe(3);
    const p = problems(() => validateConfig({ seeds: ["a/b"], weights: { nope: 1 }, limits: { kin_queries: 500, people_per_seed: 5 } }));
    expect(p).toContainEqual(expect.stringContaining("weights.nope: unknown key"));
    expect(p).toContainEqual(expect.stringContaining("limits.kin_queries: must be between 0 and 100"));
    // The old people-sampling kin limits are gone.
    expect(p).toContainEqual(expect.stringContaining("limits.people_per_seed: unknown key"));
  });

  test("mode defaults to discover and picks the weight preset; overrides stay on top", () => {
    expect(validateConfig({ seeds: ["a/b"] }).mode).toBe("discover");
    const c = validateConfig({ seeds: ["a/b"], mode: "contribute", weights: { issue_response: 9 } });
    expect(c.weights).toEqual({ ...CONTRIBUTE_WEIGHTS, issue_response: 9 });
    expect(c.weight_overrides).toEqual({ issue_response: 9 });
    expect(problems(() => validateConfig({ seeds: ["a/b"], mode: "both" }))).toEqual(["mode: must be one of discover, contribute"]);
  });

  test("YAML syntax errors say so", () => {
    expect(problems(() => parseConfig("topics: [hl7\nseeds: x"))[0]).toStartWith("YAML syntax:");
  });

  test("a list given as a string is caught", () => {
    expect(problems(() => validateConfig({ topics: "hl7" }))).toContainEqual(expect.stringContaining("topics: must be a list"));
  });
});
