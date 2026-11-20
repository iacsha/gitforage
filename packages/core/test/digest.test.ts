import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_LAYOUT, loadDigests, parseDigest, saveDigest, scoreCandidate, toDigestItems, validateConfig, type Digest } from "../src/index.ts";
import { NOW, cand, cfg } from "./helpers.ts";

const scored = (full: string, o = {}) => scoreCandidate(cand(full, { via_topics: ["hl7"], ...o }, { topics: ["hl7"] }), cfg(), NOW);

describe("digests", () => {
  test("toDigestItems keeps what the portal needs, including maintainer health", () => {
    const s = scored("a/one", { signals: { outside_prs_90d: 4, issue_response: { answered: 3, total: 5 } } });
    const [it] = toDigestItems([s]);
    expect(it).toMatchObject({ full_name: "a/one", url: "https://github.com/a/one", sources: ["search"], topics: ["hl7"], via_topics: ["hl7"],
      health: { outside_prs_90d: 4, issue_response: { answered: 3, total: 5 } } });
    expect(it.pushed_at).not.toBe("");
    expect(toDigestItems([scored("b/two")])[0].health).toBeNull();
  });

  test("save, reload newest first, and merge a second run on the same day", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-digest-"));
    const d = (date: string, mode: Digest["mode"], names: string[]): Digest =>
      ({ version: 1, date, mode, generated_at: `${date}T06:00:00.000Z`, items: toDigestItems(names.map((x) => scored(x))) });
    saveDigest(dir, d("2026-11-15", "discover", ["a/one"]));
    saveDigest(dir, d("2026-11-22", "contribute", ["c/three"]));
    saveDigest(dir, d("2026-11-22", "discover", ["a/two"]));
    saveDigest(dir, d("2026-11-22", "discover", ["a/two", "a/four"]));
    writeFileSync(join(dir, "notes.json"), "{}");
    const { digests, problems } = loadDigests(dir);
    expect(problems).toEqual([]);
    expect(digests.map((x) => `${x.date}-${x.mode}`)).toEqual(["2026-11-22-discover", "2026-11-22-contribute", "2026-11-15-discover"]);
    expect(digests[0].items.map((i) => i.full_name)).toEqual(["a/two", "a/four"]);
    expect(loadDigests(join(dir, "missing"))).toEqual({ digests: [], problems: [] });
  });

  test("bad files are reported, not trusted", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-digest-"));
    writeFileSync(join(dir, "2026-11-22-discover.json"), "not json");
    writeFileSync(join(dir, "2026-11-21-discover.json"), JSON.stringify({ version: 2, items: [] }));
    writeFileSync(join(dir, "2026-11-20-discover.json"), "x".repeat(2 * 1024 * 1024 + 1));
    mkdirSync(join(dir, "2026-11-19-discover.json"));
    const { digests, problems } = loadDigests(dir);
    expect(digests).toEqual([]);
    expect(problems).toEqual([
      "2026-11-22-discover.json: not valid JSON, ignored",
      "2026-11-21-discover.json: expected version 1 and an items list",
      "2026-11-20-discover.json: larger than 2 MB, ignored",
    ]);
    expect(parseDigest("{}", "../../x.json").problems[0]).toContain("not a digest file name");
  });

  test("item fields are validated and cleaned again on load", () => {
    const { digest } = parseDigest(JSON.stringify({ version: 1, items: [
      { full_name: "a/b", score: "9", stars: 1 },
      { full_name: "a/c", score: 1, stars: 1e15 },
      { full_name: "a/d", score: 1, stars: 3, health: { outside_prs_90d: -1, issue_response: { answered: 9, total: 2 } }, pushed_at: "never", language: "Go‮" },
    ] }), "2026-11-22-discover.json");
    expect(digest!.items.map((i) => i.full_name)).toEqual(["a/d"]);
    expect(digest!.items[0]).toMatchObject({ health: { outside_prs_90d: null, issue_response: null }, pushed_at: "", language: "Go" });
    expect(digest!.generated_at).toBe("2026-11-22T00:00:00.000Z");
  });
});

describe("config: site and feedback sections", () => {
  test("defaults", () => {
    const c = validateConfig({ topics: ["hl7"] });
    expect(c.site).toEqual({ repo: null, title: "gitforage", url: null, analytics: null, layout: DEFAULT_LAYOUT });
    expect(c.feedback).toEqual({ visitors: true, visitor_weight: 0.25, max_per_user: 3, min_account_age_days: 30 });
  });

  test("valid values", () => {
    const c = validateConfig({ topics: ["hl7"], site: { repo: "acme/portal", title: " Acme ", url: "https://forage.example.org/demo" },
      feedback: { visitors: false, visitor_weight: 0.5, max_per_user: 5, min_account_age_days: 0 } });
    expect(c.site).toEqual({ repo: "acme/portal", title: "Acme", url: "https://forage.example.org/demo/", analytics: null, layout: DEFAULT_LAYOUT });
    expect(c.feedback).toEqual({ visitors: false, visitor_weight: 0.5, max_per_user: 5, min_account_age_days: 0 });
  });

  test("hostile or wrong values are refused", () => {
    const bad = (site: unknown, feedback: unknown = undefined) => () => validateConfig({ topics: ["hl7"], site, feedback });
    expect(bad({ repo: "../x" })).toThrow("site.repo");
    expect(bad({ repo: "a/b?x" })).toThrow("site.repo");
    for (const url of ["javascript:alert(1)", "http://plain.example/", "https://user:pw@x.example/", "https://x.example/?q=1", "https://x.example/#f",
      "https://x.example:8443/", "https://x.example/a b", "https://x.example/\"onload"]) {
      expect(bad({ url })).toThrow("site.url");
    }
    expect(bad({ title: "x".repeat(81) })).toThrow("site.title");
    expect(bad({ repo: "a/b", colour: "red" })).toThrow('site.colour: unknown key');
    expect(bad(undefined, { visitor_weight: 2 })).toThrow("feedback.visitor_weight");
    expect(bad(undefined, { max_per_user: 0 })).toThrow("feedback.max_per_user");
    expect(bad(undefined, { visitors: "yes" })).toThrow("feedback.visitors");
  });
});
