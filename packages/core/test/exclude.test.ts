import { describe, expect, test } from "bun:test";
import { ConfigError, exclusionReason, unsafeRegexReason } from "../src/index.ts";
import { cand, cfg } from "./helpers.ts";

const c = cfg({
  exclude: { topics: ["awesome-list"], keywords: ["free followers", "awesome-"], owners: ["SpamCo"] },
  filters: { min_stars: 5 },
});
const none = new Set<string>();
const problems = (fn: () => unknown): string[] => {
  try { fn(); } catch (e) { if (e instanceof ConfigError) return e.problems; throw e; }
  return [];
};

describe("exclusion", () => {
  test("keeps an ordinary candidate", () => {
    expect(exclusionReason(cand("good/repo"), c, none)).toBeNull();
  });

  test("drops known repos (seeds and your stars), case-insensitively", () => {
    expect(exclusionReason(cand("Acme/Engine"), c, new Set(["acme/engine"]))).toBe("already in your seeds or stars");
  });

  test("drops excluded topics, owners and keywords", () => {
    expect(exclusionReason(cand("a/list", {}, { topics: ["airdrop", "awesome-list"] }), c, none)).toBe("excluded topic awesome-list");
    expect(exclusionReason(cand("spamco/x"), c, none)).toBe("excluded owner spamco");
    expect(exclusionReason(cand("a/b", {}, { description: "FREE FOLLOWERS links, updated daily" }), c, none)).toBe('excluded keyword "free followers"');
    expect(exclusionReason(cand("someone/awesome-hl7"), c, none)).toBe('excluded keyword "awesome-"');
  });

  test("drops archived and disabled repos", () => {
    expect(exclusionReason(cand("a/b", {}, { archived: true }), c, none)).toBe("archived");
    expect(exclusionReason(cand("a/b", {}, { disabled: true }), c, none)).toBe("disabled");
  });

  test("min_stars applies to search and kin, not to fork-only finds", () => {
    expect(exclusionReason(cand("a/b", {}, { stars: 2 }), c, none)).toBe("under min_stars (2)");
    expect(exclusionReason(cand("a/b", { sources: ["fork"] }, { stars: 0 }), c, none)).toBeNull();
    expect(exclusionReason(cand("a/b", { sources: ["fork", "kin"] }, { stars: 0 }), c, none)).toBe("under min_stars (0)");
  });

  test("language filter, when set", () => {
    const lc = cfg({ filters: { languages: ["Go", "rust"] } });
    expect(exclusionReason(cand("a/b", {}, { language: "Rust" }), lc, none)).toBeNull();
    expect(exclusionReason(cand("a/b", {}, { language: "Java" }), lc, none)).toBe("language Java not in filters.languages");
    expect(exclusionReason(cand("a/b", {}, { language: null }), lc, none)).toBe("language unknown not in filters.languages");
  });
});

describe("exclude.patterns", () => {
  const pc = cfg({
    exclude: {
      patterns: [
        "free followers list",
        { keyword: "cheatbox", in: ["name", "topics"] },
        { regex: "\\bcheat8?\\s+(menu|list)s?\\b", in: ["description"] },
        { regex: "^airdrop-(links|channels)$", in: ["topics"] },
      ],
    },
  });

  test("a plain string is a keyword in name, description and topics", () => {
    expect(exclusionReason(cand("a/b", {}, { description: "The best FREE FOLLOWERS LIST around" }), pc, none))
      .toBe('excluded keyword "free followers list" in description');
    expect(exclusionReason(cand("a/free-followers-list"), pc, none)).toBeNull(); // hyphens are not spaces
    expect(exclusionReason(cand("a/b", {}, { topics: ["free followers list"] }), pc, none)).toBe('excluded keyword "free followers list" in topics');
  });

  test("keyword limited to some fields", () => {
    expect(exclusionReason(cand("someone/CheatBox-tvs"), pc, none)).toBe('excluded keyword "cheatbox" in name');
    expect(exclusionReason(cand("a/b", {}, { topics: ["cheatbox"] }), pc, none)).toBe('excluded keyword "cheatbox" in topics');
    // Not matched in the description, since `in` leaves it out.
    expect(exclusionReason(cand("a/b", {}, { description: "works with cheatbox configs" }), pc, none)).toBeNull();
  });

  test("regex, case-insensitive, per field", () => {
    expect(exclusionReason(cand("a/b", {}, { description: "Huge CHEAT8 menus, daily" }), pc, none))
      .toBe('excluded regex "\\bcheat8?\\s+(menu|list)s?\\b" in description');
    expect(exclusionReason(cand("a/cheat menu"), pc, none)).toBeNull(); // name not in `in`
    expect(exclusionReason(cand("a/b", {}, { description: "A cheat parser library" }), pc, none)).toBeNull();
    expect(exclusionReason(cand("a/b", {}, { topics: ["airdrop", "AIRDROP-Links"] }), pc, none)).toStartWith('excluded regex "^airdrop-(links|channels)$"');
    expect(exclusionReason(cand("a/b", {}, { topics: ["airdrop-linksx"] }), pc, none)).toBeNull();
  });

  test("config errors: bad regex, unsafe regex, both or neither, bad field, unknown key", () => {
    const p = problems(() => cfg({ exclude: { patterns: [
      { regex: "(" }, { regex: "(a+)+$" }, { regex: "(\\w+\\s?){2,}" }, { regex: "(a|aa)*" }, { regex: "(x)\\1" },
      { keyword: "a", regex: "b" }, {}, { keyword: "x", in: ["readme"] }, { keyword: "x", when: 1 }, "", 7,
      { regex: "a".repeat(201) },
    ] } }));
    expect(p).toContainEqual(expect.stringMatching(/^exclude\.patterns\[0\]\.regex: /));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[1].regex: has a nested quantifier"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[2].regex: has a nested quantifier"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[3].regex: has a nested quantifier"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[4].regex: uses a backreference"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[5]: needs exactly one of keyword: or regex:"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[6]: needs exactly one"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[7].in: must be some of name, description, topics"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[8].when: unknown key"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[9]: must be a non-empty string"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[10]: must be a keyword or a mapping"));
    expect(p).toContainEqual(expect.stringContaining("exclude.patterns[11].regex: is longer than 200"));
  });

  test("safe shapes are accepted", () => {
    for (const src of ["(free|cheap) airdrop", "\\bcheatbox\\b", "x86?", "(playlist|list)s?", "[a-z]{2,5}-tv", "^x(abc)?$"]) {
      expect(unsafeRegexReason(src)).toBeNull();
    }
  });

  test("a hostile long description is matched quickly", () => {
    const evil = cfg({ exclude: { patterns: [{ regex: "a.*b.*c.*d" }] } });
    const started = performance.now();
    exclusionReason(cand("a/b", {}, { description: "a".repeat(500) }), evil, none);
    expect(performance.now() - started).toBeLessThan(200);
  });
});
