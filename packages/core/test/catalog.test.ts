import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitHub, MAX_CATALOG_BYTES, MAX_CATALOG_ITEMS, RULES, catalogConfig, catalogTopics, forage, isDefaultCandidate, loadCatalog,
  parseCatalogState, risingQueries, saveCatalog, searchQueries, selectCatalog, toCatalogItem, toCatalogItems, validateConfig,
  type CatalogItem,
} from "../src/index.ts";
import { NOW, cand, cfg, daysAgo, fakeApi, fakeClock, json, rawRepo } from "./helpers.ts";

const personalize = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  catalog: { groups: [{ name: "Healthcare", topics: ["hl7", "fhir", "dicom"] }, { name: "Rust", topics: ["rust", "tokio"] }], topics: ["games"] },
  packs: [{ id: "health", name: "Healthcare dev", topics: ["hl7", "fhir"] }],
  ...over,
});
const pcfg = (over: Record<string, unknown> = {}, site: Record<string, unknown> = {}) =>
  validateConfig({ topics: ["hl7", "mcp"], site: { personalize: personalize(site) }, ...over });

describe("config: site.personalize", () => {
  test("groups, the extra topics and the config's own topics make the catalog", () => {
    const c = pcfg();
    expect(c.site.personalize.enabled).toBe(true);
    expect(c.site.personalize.topics).toEqual(["hl7", "fhir", "dicom", "rust", "tokio", "games", "mcp"]);
    expect(c.site.personalize.groups.map((g) => g.name)).toEqual(["Healthcare", "Rust", "More topics"]);
    expect(c.site.personalize.groups[2].topics).toEqual(["games", "mcp"]);
    expect(c.site.personalize.per_topic).toBe(25);
    expect(c.site.personalize.packs).toEqual([{ id: "health", name: "Healthcare dev", topics: ["hl7", "fhir"] }]);
    expect(catalogTopics(c)).toEqual(c.site.personalize.topics);
    expect(catalogConfig(c).topics).toEqual(["hl7", "mcp", "fhir", "dicom", "rust", "tokio", "games"]);
    // Off by default, and off means no catalog topics.
    expect(catalogTopics(validateConfig({ topics: ["hl7"] }))).toEqual([]);
    expect(catalogTopics(pcfg({}, { enabled: false }))).toEqual([]);
  });

  test("hostile or wrong values are refused with a path", () => {
    const bad = (site: Record<string, unknown>, over: Record<string, unknown> = {}) => () => pcfg(over, site);
    expect(bad({ catalog: { groups: [{ name: "<img src=x>", topics: ["hl7"] }] } })).toThrow("site.personalize.catalog.groups[0].name");
    expect(bad({ catalog: { groups: [{ name: "x", topics: ["Not A Topic"] }] } })).toThrow("is not a GitHub topic");
    expect(bad({ catalog: { topics: ["iptv"] } }, { exclude: { topics: ["iptv"] } })).toThrow("topics also in exclude.topics: iptv");
    expect(bad({ packs: [{ id: "Bad Id", name: "x", topics: ["hl7"] }] })).toThrow("site.personalize.packs[0].id");
    expect(bad({ packs: [{ id: "p", name: "x", topics: ["nope"] }] })).toThrow("not in the catalog: nope");
    expect(bad({ packs: [{ id: "p", name: "a", topics: ["hl7"] }, { id: "p", name: "b", topics: ["hl7"] }] })).toThrow('"p" is used twice');
    expect(bad({ catalog: { per_topic: 0 } })).toThrow("site.personalize.catalog.per_topic");
    expect(bad({ extra: 1 })).toThrow("site.personalize.extra: unknown key");
    const many = Array.from({ length: 151 }, (_, i) => `t${i}`);
    expect(bad({ catalog: { topics: many } })).toThrow("at most 150 topics");
    expect(() => validateConfig({ topics: [], keywords: ["x"], site: { personalize: { enabled: true } } })).toThrow("needs topics when personalize is enabled");
  });
});

describe("catalog searches", () => {
  test("one new and one rising search per extra catalog topic, after the config's own", () => {
    const c = pcfg();
    const extra = catalogTopics(c);
    const qs = searchQueries(c, NOW, extra);
    expect(qs.map((q) => `${q.kind}:${q.term}`)).toEqual(["topic:hl7", "topic:mcp", "catalog:fhir", "catalog:dicom", "catalog:rust", "catalog:tokio", "catalog:games"]);
    expect(qs[2].q).toBe(`topic:fhir created:>=2025-11-20 stars:>=5 archived:false`);
    expect(risingQueries(c, NOW, extra).filter((q) => q.kind === "catalog")).toHaveLength(5);
    expect(searchQueries(c, NOW)).toHaveLength(2);
  });

  test("candidates found only by catalog searches stay out of the default digest", () => {
    expect(isDefaultCandidate(cand("a/b", { via_topics: ["hl7"] }))).toBe(true);
    expect(isDefaultCandidate(cand("a/b", { via_topics: [], via_catalog: ["rust"] }))).toBe(false);
    expect(isDefaultCandidate(cand("a/b", { sources: ["kin"], via_topics: [], via_catalog: ["rust"] }))).toBe(true);
  });

  function world() {
    return fakeApi([
      [/^\/search\/repositories\?q=topic:hl7 created/, () => json({ items: [rawRepo("h/one", { topics: ["hl7", "fhir"], created_at: daysAgo(60), stargazers_count: 80 })] })],
      [/^\/search\/repositories\?q=topic:rust created/, () => json({ items: [
        rawRepo("r/big", { topics: ["rust"], created_at: daysAgo(30), stargazers_count: 4000, description: "A fast thing" }),
        rawRepo("h/one", { topics: ["hl7", "fhir", "rust"], created_at: daysAgo(60), stargazers_count: 80 }),
      ] })],
      [/^\/search\/repositories\?q=topic:games created/, () => json({ items: [rawRepo("g/zh", { topics: ["games"], created_at: daysAgo(30), description: "一个非常好的游戏引擎，适合初学者使用" })] })],
      [/^\/search\/repositories/, () => json({ items: [] })],
      [/\/community\/profile$/, () => json({ files: {} })],
      [/\/releases\?per_page=1$/, () => json([])],
    ]);
  }

  test("forage: the default ranking is the same with or without the catalog; the catalog adds the rest", async () => {
    const c = pcfg({ filters: { spoken_languages: ["en"] } });
    const run = async (catalog: boolean) => {
      const api = world();
      const clock = fakeClock();
      const gh = new GitHub({ token: "t", fetch: api.fetch, now: clock.now, sleep: clock.sleep });
      return { res: await forage(c, gh, { now: NOW, catalog }), calls: api.calls };
    };
    const off = await run(false);
    const on = await run(true);
    expect(off.res.catalog).toBeNull();
    expect(on.res.ranked.map((s) => [s.candidate.repo.full_name, s.score])).toEqual(off.res.ranked.map((s) => [s.candidate.repo.full_name, s.score]));
    expect(on.res.ranked.map((s) => s.candidate.repo.full_name)).toEqual(["h/one"]);
    expect(on.res.found.catalog).toBe(1);
    // r/big is catalog only; g/zh is dropped by the language filter like any other candidate.
    expect(on.res.catalog!.map((s) => s.candidate.repo.full_name).sort()).toEqual(["h/one", "r/big"]);
    expect(on.res.excluded.map((e) => e.full_name)).toContain("g/zh");
    expect(on.calls.filter((x) => x.startsWith("/search/")).length - off.calls.filter((x) => x.startsWith("/search/")).length).toBe(10);
    const items = toCatalogItems(on.res.catalog!, c, NOW);
    const one = items.find((i) => i.full_name === "h/one")!;
    const scored = on.res.catalog!.find((s) => s.candidate.repo.full_name === "h/one")!;
    const topicPts = scored.reasons.find((r) => r.rule === "topic_match")!.points;
    expect(one.base).toBeCloseTo(scored.score - topicPts, 5);
    expect(one.topics).toEqual(["hl7", "fhir", "rust"]);
    expect(one.reasons.some((r) => r.rule === "topic_match")).toBe(false);
    expect(items.find((i) => i.full_name === "r/big")!.velocity).toBe(4000);
    // Restored: the digest's popularity is the one computed for the default topics.
    expect(on.res.ranked[0].candidate.popularity!.group).toBe(off.res.ranked[0].candidate.popularity!.group);
  });
});

function item(full: string, topics: string[], base: number, o: Partial<CatalogItem> = {}): CatalogItem {
  return {
    full_name: full, description: "d", topics, language: "Go", stars: 10, velocity: 1, created_at: "2026-10-01T00:00:00.000Z",
    pushed_at: "2026-11-19T00:00:00.000Z", sources: ["search"], base, rising: 0, reasons: [], lang: "en", ...o,
  };
}

describe("catalog selection and the state file", () => {
  test("keeps the best per_topic of each topic, ordered by base score", () => {
    const items = [item("a/1", ["x"], 1), item("a/2", ["x"], 5), item("a/3", ["x", "y"], 3), item("a/4", ["y"], 0.5), item("a/5", ["y"], 0.1)];
    const s = selectCatalog(items, ["x", "y"], 2);
    expect(s.items.map((i) => i.full_name)).toEqual(["a/2", "a/3", "a/4"]);
    expect(s.per_topic).toBe(2);
  });

  test("stays within the byte budget and the item cap by lowering the per-topic cap", () => {
    const big = Array.from({ length: 4000 }, (_, i) => item(`o/r${i}`, [`t${i % 40}`], i % 97, { description: "x".repeat(190) }));
    const s = selectCatalog(big, Array.from({ length: 40 }, (_, i) => `t${i}`), 100, 200_000);
    expect(Buffer.byteLength(JSON.stringify(s.items))).toBeLessThanOrEqual(200_000);
    expect(s.per_topic).toBeLessThan(100);
    // Every topic still has its best items.
    expect(new Set(s.items.flatMap((i) => i.topics)).size).toBe(40);
    const full = selectCatalog(big, Array.from({ length: 40 }, (_, i) => `t${i}`), 100);
    expect(full.items.length).toBeLessThanOrEqual(MAX_CATALOG_ITEMS);
    expect(Buffer.byteLength(JSON.stringify(full.items))).toBeLessThanOrEqual(MAX_CATALOG_BYTES);
  });

  test("a hostile state file is cleaned on read", () => {
    const text = JSON.stringify({ version: 1, generated_at: "2026-11-22T00:00:00Z", items: [
      { full_name: "javascript:alert(1)//x", topics: ["x"], stars: 1, base: 1, velocity: 0 },
      { full_name: "../etc/passwd", topics: ["x"], stars: 1, base: 1, velocity: 0 },
      { full_name: "ok/repo", topics: ["x", "Bad Topic", "__proto__", "notallowed"], stars: 5, base: 2, velocity: 3, rising: 1,
        description: "a‮b\u0000c<script>", language: "Go", sources: ["search", "evil"], lang: "<b>",
        reasons: [{ rule: "<x>", points: 1, text: "t" }, { rule: "license", points: 1, text: "MIT⁦ licensed" }, { rule: "topic_match", points: 9, text: "x" }],
        url: "javascript:alert(1)", created_at: "nope" },
      { full_name: "ok/repo", topics: ["x"], stars: 1, base: 1, velocity: 0 },
      { full_name: "no/topics", topics: ["notallowed"], stars: 1, base: 1, velocity: 0 },
      { full_name: "nan/repo", topics: ["x"], stars: "5", base: 1, velocity: 0 },
    ] });
    const { catalog, problems } = parseCatalogState(text, new Set(["x"]));
    expect(catalog!.items).toHaveLength(1);
    const it = catalog!.items[0];
    expect(it).toEqual({
      full_name: "ok/repo", description: "abc<script>", topics: ["x"], language: "Go", stars: 5, velocity: 3, created_at: "", pushed_at: "",
      sources: ["search"], base: 2, rising: 1, reasons: [{ rule: "license", points: 1, text: "MIT licensed" }], lang: "und",
    });
    expect(Object.keys(it)).not.toContain("url");
    expect(problems.length).toBe(4);
    expect(parseCatalogState("not json").catalog).toBeNull();
    expect(parseCatalogState(JSON.stringify({ version: 2, items: [] })).catalog).toBeNull();
    expect(parseCatalogState("x".repeat(5 * 1024 * 1024)).problems[0]).toContain("larger than 4 MB");
    expect(typeof toCatalogItem(null)).toBe("string");
  });

  test("saveCatalog and loadCatalog round-trip; a missing file is no catalog", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-cat-"));
    const p = join(dir, "state", "catalog.json");
    expect(loadCatalog(p)).toEqual({ catalog: null, problems: [] });
    saveCatalog(p, { version: 1, generated_at: "2026-11-22T00:00:00.000Z", items: [item("a/b", ["x"], 1)] });
    expect(loadCatalog(p, new Set(["x"])).catalog!.items[0].full_name).toBe("a/b");
    writeFileSync(p, "{");
    expect(loadCatalog(p).catalog).toBeNull();
  });

  test("the topic reason the browser writes is the server's", () => {
    const c = validateConfig({ topics: ["hl7", "fhir", "mcp"] });
    const one = RULES.topic_match(cand("a/b", { via_topics: ["hl7"] }), c, NOW)!;
    const two = RULES.topic_match(cand("a/b", { via_topics: ["hl7", "fhir"] }), c, NOW)!;
    expect(one.text).toBe("your topic hl7");
    expect(two.text).toBe("2 of your topics (hl7, fhir)");
  });
});
