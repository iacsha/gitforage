import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RULES, validateConfig, type CatalogItem, type CatalogState, type Digest, type DigestItem } from "@gitforage/core";
import { csp, renderSite } from "../src/index.ts";
import * as core from "../assets/personalize-core.js";

const NOW = "2026-11-22T12:00:00.000Z";
const assets = join(import.meta.dir, "..", "assets");

const config = (personalize: Record<string, unknown> | null = {}, site: Record<string, unknown> = {}) => validateConfig({
  topics: ["hl7", "fhir"],
  filters: { spoken_languages: ["en"] },
  site: {
    repo: "acme/portal", title: "Acme portal", ...site,
    ...(personalize ? {
      personalize: {
        enabled: true,
        catalog: { groups: [{ name: "Healthcare", topics: ["hl7", "fhir", "dicom"] }, { name: "Rust & Go", topics: ["rust", "golang"] }], topics: ["games"], per_topic: 25 },
        packs: [{ id: "health", name: "Healthcare dev", topics: ["hl7", "fhir", "dicom"] }, { id: "systems", name: "Systems", topics: ["rust", "golang"] }],
        ...personalize,
      },
    } : {}),
  },
});

function item(full: string, topics: string[], base: number, o: Partial<CatalogItem> = {}): CatalogItem {
  return {
    full_name: full, description: "A tool", topics, language: "Go", stars: 100, velocity: 12, created_at: "2026-10-01T00:00:00.000Z",
    pushed_at: "2026-11-19T00:00:00.000Z", sources: ["search"], base, rising: 1, reasons: [{ rule: "license", points: 1, text: "MIT licensed" }],
    lang: "en", ...o,
  };
}
const state = (items: unknown[]): CatalogState => ({ version: 1, generated_at: "2026-11-22T06:00:00.000Z", items: items as CatalogItem[] });

function dItem(full: string, o: Partial<DigestItem> = {}): DigestItem {
  return {
    full_name: full, url: `https://github.com/${full}`, score: 10, stars: 120, language: "TypeScript", description: "A tool",
    sources: ["search"], reasons: [{ rule: "topic_match", points: 3, text: "your topic hl7" }], topics: ["hl7"], via_topics: [],
    created_at: "2026-10-01T00:00:00.000Z", pushed_at: "2026-11-20T00:00:00.000Z", lang: "en", health: null, ...o,
  };
}
const digest = (items: DigestItem[]): Digest => ({ version: 1, date: "2026-11-22", mode: "discover", generated_at: "2026-11-22T06:00:00.000Z", items });

const HOSTILE = `<img src=x onerror="alert(1)"> <script>alert(2)</script> javascript:alert(3) " onmouseover="x" ‮evil⁦ \u0000`;

describe("catalog.json", () => {
  const cfg = config();
  const files = renderSite(cfg, [digest([dItem("a/one")])], {
    now: NOW,
    catalog: state([
      item("good/one", ["hl7", "fhir"], 9),
      item("evil/desc", ["rust"], 5, { description: HOSTILE, language: "<svg onload=x>", reasons: [{ rule: "license", points: 1, text: HOSTILE }] }),
      { full_name: "javascript:alert(1)//x", topics: ["hl7"], stars: 1, base: 1, velocity: 0 },
      { full_name: "a/b\"onclick=x", topics: ["hl7"], stars: 1, base: 1, velocity: 0 },
      item("off/catalog", ["iptv"], 50),
      { ...item("nan/score", ["hl7"], 1), base: Number.NaN },
    ]),
  });
  const cat = JSON.parse(files.get("catalog.json")!);

  test("is emitted with the topics, groups, packs and weights, and the assets ship with it", () => {
    expect(cat.version).toBe(1);
    expect(cat.portal).toBe("acme/portal");
    expect(cat.topics).toEqual(["hl7", "fhir", "dicom", "rust", "golang", "games"]);
    expect(cat.groups.map((g: any) => g.name)).toEqual(["Healthcare", "Rust & Go", "More topics"]);
    expect(cat.packs.map((p: any) => p.id)).toEqual(["health", "systems"]);
    expect(cat.weights).toEqual({ topic_match: 3, feedback: 1 });
    expect(cat.spoken).toEqual(["en"]);
    expect(cat.analytics).toBe(false);
    expect(files.has("assets/personalize.js")).toBe(true);
    expect(files.has("assets/personalize-core.js")).toBe(true);
    const off = renderSite(config(null), [], { now: NOW });
    expect(off.has("catalog.json")).toBe(false);
    expect(off.has("assets/personalize.js")).toBe(false);
  });

  test("every item is validated: bad names and other topics dropped, text cleaned, no URLs", () => {
    expect(cat.items.map((i: any) => i.full_name)).toEqual(["good/one", "evil/desc"]);
    const evil = cat.items[1];
    expect(evil.description).not.toMatch(/[‮⁦\u0000]/);
    expect(evil.language.length).toBeLessThanOrEqual(40);
    for (const it of cat.items) {
      expect(Object.keys(it).sort()).toEqual(["base", "created_at", "description", "full_name", "lang", "language", "pushed_at", "reasons", "rising", "sources", "stars", "topics", "velocity"]);
      expect(JSON.stringify(it)).not.toContain("https://");
    }
    // The browser's own validator agrees with what the build emitted.
    const parsed = core.parseCatalog(files.get("catalog.json")!)!;
    expect(parsed.items.map((i) => i.full_name)).toEqual(["good/one", "evil/desc"]);
    // A language the build kept but the client allow-list refuses is dropped, not shown.
    expect(parsed.items[1].language).toBeNull();
  });

  test("a big catalog stays under the size budget (under 400 KB gzipped)", () => {
    const topics = Array.from({ length: 100 }, (_, i) => `topic-${i}`);
    const big = validateConfig({ topics: ["hl7"], site: { repo: "acme/portal", personalize: { enabled: true, catalog: { topics, per_topic: 100 } } } });
    const items = Array.from({ length: 6000 }, (_, i) => item(`owner-${i}/repo-name-${i}`, [topics[i % 100], topics[(i * 7) % 100], "hl7"], i % 113, {
      description: `A reasonably long description for repo ${i}, describing what it does in about two hundred characters so the size is realistic for GitHub.`,
      reasons: [{ rule: "star_velocity", points: 2.1, text: "~120 stars a month (new, 2 months ago, top 10% in topic)" }, { rule: "recent_push", points: 3, text: "pushed 2d ago" },
        { rule: "license", points: 1, text: "MIT licensed" }, { rule: "readme", points: 1, text: "docs: README, description" }],
    }));
    const text = renderSite(big, [], { now: NOW, catalog: state(items) }).get("catalog.json")!;
    const json = JSON.parse(text);
    expect(json.items.length).toBeLessThanOrEqual(2500);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(1_700_000);
    expect(Bun.gzipSync(Buffer.from(text)).byteLength).toBeLessThan(400 * 1024);
    expect(json.per_topic).toBeLessThan(100);
  });
});

describe("the Discover page with personalization", () => {
  const cfg = config();
  const files = renderSite(cfg, [digest([dItem("a/one"), dItem("b/two", { topics: ["fhir"] })])], { now: NOW, catalog: state([item("good/one", ["hl7"], 9)]) });
  const index = files.get("index.html")!;
  const policy = (body: string) => /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(body)![1].replace(/&#39;/g, "'");

  test("the CSP adds connect-src for itself and api.github.com only, only when enabled, only on Discover", () => {
    expect(policy(index)).toBe("default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self' https://api.github.com; base-uri 'none'; form-action 'none'");
    for (const [path, body] of files) {
      if (!path.endsWith(".html") || path === "index.html") continue;
      expect([path, policy(body)]).toEqual([path, "default-src 'none'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'"]);
    }
    const off = renderSite(config(null), [digest([dItem("a/one")])], { now: NOW }).get("index.html")!;
    expect(policy(off)).not.toContain("connect-src");
    expect(csp(cfg.site)).not.toContain("connect-src");
    expect(csp(cfg.site, { personalize: true })).toContain("connect-src 'self' https://api.github.com;");
    const withGc = config({}, { analytics: { provider: "goatcounter", code: "acme" } });
    expect(csp(withGc.site, { personalize: true })).toContain("connect-src 'self' https://api.github.com https://acme.goatcounter.com;");
    expect(policy(index)).not.toMatch(/unsafe-|\*/);
  });

  test("scripts: theme.js, site.js and the personalize module, all same-origin; no inline script or style", () => {
    expect(index.match(/<script\b[^>]*>/g)).toEqual(['<script src="assets/theme.js">', '<script src="assets/site.js" defer>', '<script type="module" src="assets/personalize.js">']);
    expect(index).not.toMatch(/<style\b|\sstyle=|\son[a-z]+=/i);
    expect(files.get("involved.html")).not.toContain("personalize.js");
  });

  test("the default digest is still the server-rendered list, so it works with JavaScript off", () => {
    expect(index).toContain('<div data-default-view>\n<div class="view-bar"');
    expect(index).toContain('href="https://github.com/a/one"');
    expect(index).toContain('<div class="personal-bar" data-personal-bar hidden>');
    expect(index).toContain('<section class="personal" data-personal hidden aria-labelledby="personal-title">');
    expect(index).toContain('<li data-lang="en" data-lang-match="yes" data-sources="search" data-topics="hl7"');
    expect(index).toContain('data-repo="a/one">');
    expect(index).toContain('<div class="local-marks" data-local-marks hidden>');
    expect(index).toContain('aria-label="Hide a/one, in this browser only">Hide</button>');
  });

  test("the picker dialog is labelled, described, grouped and keyboard friendly", () => {
    const d = index.slice(index.indexOf("<dialog"), index.indexOf("</dialog>") + 9);
    expect(d).toContain('<dialog class="pick" id="pick-dialog" aria-labelledby="pick-title" aria-describedby="pick-privacy" data-pick-dialog>');
    expect(d).toContain('<h2 id="pick-title">Pick your patch</h2>');
    expect(d).toContain('<p class="pick-note" id="pick-privacy">');
    expect(index).toContain('data-pick-open aria-haspopup="dialog" aria-controls="pick-dialog"');
    expect(d).toContain('aria-label="Close without changes"');
    expect(d).toContain('<label for="pick-search">Search topics</label> <input id="pick-search" type="search"');
    expect(d).toContain('<label for="pick-user">GitHub username</label>\n<input id="pick-user" type="text"');
    expect(d).toContain('maxlength="39" aria-describedby="pick-stars-note"');
    expect(d).toContain("Your browser asks GitHub directly; gitforage never sees your username.");
    expect(d).toContain('role="status" aria-live="polite" data-stars-status');
    expect(d).toContain('<div class="pick-packs" role="group" aria-labelledby="pick-packs-title">');
    expect(d).toContain('<button type="button" class="filter-chip" data-pack="health" aria-pressed="false">Healthcare dev</button>');
    expect(d).toContain('<fieldset class="pick-group" data-pick-group>\n<legend>Rust &amp; Go</legend>');
    expect(d).toContain('<label class="pick-topic" data-topic-row="dicom"><input type="checkbox" data-topic="dicom"> dicom</label>');
    expect(d).toContain('aria-live="polite" aria-atomic="true" data-pick-count');
    expect(d).toContain(">Clear my local marks</button>");
    // Every input has a label: either wraps it or points at it.
    for (const m of d.matchAll(/<input id="([^"]+)"/g)) expect(d).toContain(`<label for="${m[1]}">`);
    expect(d.match(/<input type="checkbox"/g)!.length).toBe(6);
    // No form: form-action 'none' stays meaningful and nothing submits.
    expect(d).not.toContain("<form");
  });

  test("every data-* attribute on the page is allow-listed with a strict value", () => {
    const names = [...index.matchAll(/\s(data-[a-z-]+)(?:="([^"]*)")?/g)];
    const ALLOWED = new Set([
      "data-lang-default", "data-density", "data-sort-default", "data-fields-off", "data-lang", "data-lang-match", "data-sources", "data-topics",
      "data-score", "data-newest", "data-stars", "data-rising", "data-rank", "data-card", "data-cards", "data-theme-toggle", "data-theme-label",
      "data-lang-toggle", "data-pref-status", "data-density-group", "data-density-option", "data-view-bar", "data-sort-select", "data-field",
      "data-filter", "data-value", "data-filter-count", "data-filter-clear", "data-filter-empty",
      "data-repo", "data-local-marks", "data-local-mark", "data-personal-bar", "data-pick-open", "data-personal-summary", "data-copy-link",
      "data-personal-reset", "data-share-wrap", "data-share-url", "data-default-view", "data-personal", "data-pcards", "data-personal-empty",
      "data-personal-more", "data-pick-dialog", "data-pick-cancel", "data-pack", "data-stars-user", "data-stars-go", "data-stars-status",
      "data-stars-cached", "data-stars-cached-text", "data-stars-reuse", "data-topic-search", "data-pick-group", "data-topic-row", "data-topic",
      "data-topic-none", "data-marks-count", "data-marks-clear", "data-pick-count", "data-pick-apply", "data-pick-none",
    ]);
    for (const [, n, v] of names) {
      expect([n, ALLOWED.has(n)]).toEqual([n, true]);
      if (n === "data-repo") expect(v).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
      if (n === "data-pack") expect(v).toMatch(core.PACK_RE);
      if (n === "data-topic" || n === "data-topic-row") expect(v).toMatch(core.TOPIC_RE);
      if (n === "data-local-mark") expect(["keep", "skip"]).toContain(v);
    }
  });

  test("hostile group and pack names are refused by the config, and escaped if they ever got through", () => {
    expect(() => config({ catalog: { groups: [{ name: "<b>x</b>", topics: ["hl7"] }] } })).toThrow("site.personalize.catalog.groups[0].name");
    expect(() => config({ packs: [{ id: "p", name: "a\u0007b", topics: ["hl7"] }] })).toThrow("site.personalize.packs[0].name");
    const amp = renderSite(config({ packs: [{ id: "p", name: `Q&A "pack"`, topics: ["hl7"] }] }), [], { now: NOW }).get("index.html")!;
    expect(amp).toContain(">Q&amp;A &quot;pack&quot;</button>");
  });
});

describe("dangerous sinks in the portal scripts", () => {
  const scripts = readdirSync(assets).filter((f) => f.endsWith(".js"));

  test("no script writes markup or evaluates strings", () => {
    expect(scripts.sort()).toEqual(["fieldnote.js", "personalize-core.js", "personalize.js", "rings.js", "site.js", "strings.js", "theme.js"]);
    const SINKS = [/innerHTML\s*=/, /\.innerHTML\b/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /Function\s*\(/, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/, /srcdoc/, /createContextualFragment/, /DOMParser/];
    for (const f of scripts) {
      const js = readFileSync(join(assets, f), "utf8");
      for (const re of SINKS) expect([f, re.source, re.test(js)]).toEqual([f, re.source, false]);
    }
  });

  test("the scan itself catches each sink", () => {
    const SINK_RE = /innerHTML\s*=|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|Function\s*\(/;
    for (const bad of ["el.innerHTML = x", "el.outerHTML", "el.insertAdjacentHTML('a', x)", "document.write(x)", "eval(x)", "new Function('x')", "Function('return 1')"]) {
      expect(SINK_RE.test(bad)).toBe(true);
    }
  });

  test("personalize.js sets attributes only through the allow-list, links only to GitHub, storage only in try", () => {
    const js = readFileSync(join(assets, "personalize.js"), "utf8");
    const direct = [...js.matchAll(/\.setAttribute\(/g)].length;
    expect(direct).toBe(2); // the one inside setAttr, and the one inside svgEl (the tree ring)
    expect(js).toContain('if (!ATTRS.has(name)) throw new Error("attribute not allowed: " + name);');
    expect(js).toContain('if (!SVG_ATTRS.has(k)) throw new Error("svg attribute not allowed: " + k);');
    expect(js).toContain('if (tag !== "svg" && tag !== "circle") throw new Error("svg tag not allowed: " + tag);');
    expect(js).toContain('&& !NUM_RE.test(v)) throw new Error("bad ring number");');
    expect(js).toContain('if (name === "href" && !core.SAFE_HREF_RE.test(v)) throw new Error("link not allowed");');
    expect(js).not.toMatch(/\.(href|src|action)\s*=/);
    expect(js).not.toMatch(/querySelector(All)?\([^)]*\+/);
    const uses = js.split("window.localStorage").length - 1;
    const guarded = [...js.matchAll(/try \{[^}]*localStorage[^}]*\}/g)].reduce((n, m) => n + m[0].split("window.localStorage").length - 1, 0);
    expect(uses).toBe(3);
    expect(guarded).toBe(uses);
    // The only network calls: catalog.json on this site, and GitHub's starred list built by starredUrl.
    expect([...js.matchAll(/fetch\(([^,]+),/g)].map((m) => m[1])).toEqual(['"catalog.json"', "url"]);
    expect(js).toContain('credentials: "omit", referrerPolicy: "no-referrer"');
    for (const bad of ["javascript:alert(1)", "https://evil.example/a/b", "https://github.com.evil.example/a/b", "https://github.com/a/b\" x", "//github.com/a/b"]) {
      expect(core.SAFE_HREF_RE.test(bad)).toBe(false);
    }
    expect(core.SAFE_HREF_RE.test(core.feedbackUrl("acme/portal", "keep", "a/b")!)).toBe(true);
  });
});

/** A catalog as the browser sees it. */
function clientCatalog(items: CatalogItem[] = []) {
  const text = renderSite(config(), [], { now: NOW, catalog: state(items) }).get("catalog.json")!;
  return core.parseCatalog(text)!;
}

describe("personalize-core.js: validation of everything from outside", () => {
  const cat = clientCatalog([item("a/one", ["hl7"], 1)]);

  test("usernames", () => {
    for (const ok of ["octocat", "a", "A-b-9", "x".repeat(39)]) expect(core.isLogin(ok)).toBe(true);
    for (const bad of ["", "-lead", "a_b", "a/b", "../x", "x".repeat(40), "a b", "a\u0000", "ok?x=1", "%2e%2e", "‮ab", 5, null]) {
      expect([bad, core.isLogin(bad)]).toEqual([bad, false]);
    }
    expect(core.starredUrl("octocat", 1)).toBe("https://api.github.com/users/octocat/starred?per_page=100&page=1");
    expect(core.starredUrl("../../evil", 1)).toBeNull();
    expect(core.starredUrl("octocat", 4)).toBeNull();
    expect(core.starredUrl("octocat", 0)).toBeNull();
  });

  test("URL params: only catalog topics and pack ids, capped", () => {
    expect(core.parseParams("?t=hl7,fhir", cat)).toEqual({ topics: ["hl7", "fhir"], pack: null });
    expect(core.parseParams("?pack=health", cat)).toEqual({ topics: ["hl7", "fhir", "dicom"], pack: "health" });
    expect(core.parseParams("?t=rust&pack=health", cat)).toEqual({ topics: ["rust"], pack: "health" });
    expect(core.parseParams("?t=hl7,hl7,HL7,nope,<script>,__proto__,constructor,%22onclick", cat)).toEqual({ topics: ["hl7"], pack: null });
    expect(core.parseParams("?pack=__proto__", cat)).toBeNull();
    expect(core.parseParams("?t=" + "hl7,".repeat(200), cat)).toBeNull();
    expect(core.parseParams("?" + "a".repeat(2000), cat)).toBeNull();
    expect(core.parseParams("", cat)).toBeNull();
    expect(core.parseParams("?t=javascript:alert(1)", cat)).toBeNull();
    expect(core.queryFor({ topics: ["hl7", "fhir"], pack: "health" })).toBe("?t=hl7,fhir&pack=health");
    expect(core.queryFor({ topics: [], pack: null })).toBe("");
  });

  test("localStorage picks, marks and the stars cache are schema-checked on read", () => {
    expect(core.readPicks(core.writePicks({ topics: ["hl7", "rust"], pack: null }), cat)).toEqual({ topics: ["hl7", "rust"], pack: null });
    for (const bad of [null, "", "{", "[]", '{"v":2,"topics":["hl7"]}', '{"v":1,"topics":"hl7"}', '{"v":1,"topics":["nope"]}', "x".repeat(5000),
      '{"v":1,"topics":["hl7"],"__proto__":{"polluted":1}}']) {
      const r = core.readPicks(bad, cat);
      if (r) expect(r).toEqual({ topics: ["hl7"], pack: null });
      else expect(r).toBeNull();
    }
    expect(({} as any).polluted).toBeUndefined();
    const marks = core.readMarks(JSON.stringify({ v: 1, marks: {
      "a/one": { mark: "keep", topics: ["hl7", "Bad Topic"], language: "Go" },
      "../x": { mark: "skip", topics: [] },
      "b/two": { mark: "boost", topics: [] },
      "c/three": { mark: "skip", topics: ["rust"], language: "<b>" },
      "__proto__": { mark: "keep", topics: [] },
    } }));
    expect(marks).toEqual(Object.assign(Object.create(null), { "a/one": { mark: "keep", topics: ["hl7"], language: "Go" }, "c/three": { mark: "skip", topics: ["rust"], language: null } }));
    expect(Object.keys(core.readMarks("x".repeat(70000)))).toEqual([]);
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 600; i++) many[`o/r${i}`] = { mark: "keep", topics: [] };
    expect(Object.keys(core.readMarks(JSON.stringify({ v: 1, marks: many })))).toHaveLength(500);
    const now = Date.parse(NOW);
    const cache = core.writeStarsCache([["hl7", 0.5], ["fhir", 0.25]], now);
    expect(JSON.parse(cache)).toEqual({ v: 1, date: "2026-11-22", weights: [["hl7", 0.5], ["fhir", 0.25]] });
    expect(Object.keys(JSON.parse(cache)).sort()).toEqual(["date", "v", "weights"]); // nothing about the visitor
    expect(core.readStarsCache(cache, cat, now)).toEqual({ date: "2026-11-22", weights: [["hl7", 0.5], ["fhir", 0.25]] });
    expect(core.readStarsCache(cache, cat, now + 31 * 86400000)).toBeNull();
    expect(core.readStarsCache('{"v":1,"date":"2026-11-22","weights":[["nope",1],["hl7",-1],["hl7","x"],"bad"]}', cat, now)).toBeNull();
    expect(core.readStarsCache('{"v":1,"date":"2099-01-01","weights":[["hl7",1]]}', cat, now)).toBeNull();
  });

  test("catalog.json is shape-checked and capped in the browser too", () => {
    expect(core.parseCatalog("nope")).toBeNull();
    expect(core.parseCatalog('{"version":2,"items":[],"topics":[]}')).toBeNull();
    expect(core.parseCatalog("x".repeat(4_000_001))).toBeNull();
    const evil = core.parseCatalog(JSON.stringify({
      version: 1, topics: ["hl7", "Bad", "<x>"], portal: "acme/portal?x", weights: { topic_match: "9", feedback: 1e9 },
      groups: [{ name: "<b>G‮</b>", topics: ["hl7", "nope"] }], packs: [{ id: "Bad Id", name: "x", topics: ["hl7"] }, { id: "ok", name: "OK", topics: ["nope"] }],
      items: [
        { full_name: "ok/one", topics: ["hl7", "nope"], stars: 5, base: 2, velocity: 1, rising: 0, description: "a\u0000b", reasons: [{ rule: "x", points: 1, text: "t" }, { rule: "topic_match", points: 9, text: "x" }], lang: "<b>", sources: ["evil", "kin"] },
        { full_name: "javascript:x", topics: ["hl7"], stars: 1, base: 1, velocity: 1, rising: 0 },
        { full_name: "ok/two", topics: ["hl7"], stars: -1, base: 1, velocity: 1, rising: 0 },
      ],
    }))!;
    expect(evil.topics).toEqual(["hl7"]);
    expect(evil.portal).toBeNull();
    expect(evil.weights).toEqual({ topic_match: 3, feedback: 1 });
    expect(evil.groups).toEqual([{ name: "<b>G</b>", topics: ["hl7"] }]);
    expect(evil.packs).toEqual([]);
    expect(evil.items.map((i) => i.full_name)).toEqual(["ok/one"]);
    expect(evil.items[0]).toMatchObject({ description: "ab", lang: "und", sources: ["kin"], reasons: [{ rule: "x", points: 1, text: "t" }] });
  });

  test("GitHub's starred list: only arrays of up to 100 objects, only their topics", () => {
    expect(core.starredTopics([{ full_name: "<x>", topics: ["hl7", "Bad", 5, "rust"], owner: { login: "x" } }, { topics: "hl7" }])).toEqual([["hl7", "rust"], []]);
    expect(core.starredTopics({ message: "Not Found" })).toBeNull();
    expect(core.starredTopics([1, 2])).toBeNull();
    expect(core.starredTopics(Array.from({ length: 101 }, () => ({ topics: [] })))).toBeNull();
    expect(core.starredTopics(null)).toBeNull();
  });
});

describe("personalize-core.js: ranking", () => {
  const items = [
    item("a/both", ["hl7", "fhir"], 5, { stars: 10 }),
    item("a/hl7", ["hl7"], 8, { stars: 50 }),
    item("a/rust", ["rust"], 20, { stars: 900, language: "Rust" }),
    item("a/tie", ["hl7"], 8, { stars: 50 }),
  ];
  const cat = clientCatalog(items);
  const W = cat.weights;

  test("base score plus topic_match per selected topic; repos without a selected topic are hidden", () => {
    const r = core.rank(cat.items, ["hl7", "fhir"], {}, W);
    expect(r.map((x) => [x.item.full_name, x.score])).toEqual([["a/hl7", 11], ["a/tie", 11], ["a/both", 11]]);
    expect(r.map((x) => x.item.full_name)).not.toContain("a/rust");
    expect(r.find((x) => x.item.full_name === "a/both")!.hits).toEqual(["hl7", "fhir"]);
    // Ties: stars, then name.
    expect(r.map((x) => x.item.full_name)).toEqual(["a/hl7", "a/tie", "a/both"]);
    expect(core.rank(cat.items, ["rust"], {}, W).map((x) => x.score)).toEqual([23]);
    expect(core.rank(cat.items, [], {}, W)).toEqual([]);
  });

  test("the topic reason is worded exactly as the server words it", () => {
    const server = validateConfig({ topics: ["hl7", "fhir"] });
    const cand = (via: string[]) => ({ repo: { topics: [] } as any, sources: ["search"], via_topics: via, via_keywords: [] }) as any;
    expect(core.topicReason(["hl7"])).toBe(RULES.topic_match(cand(["hl7"]), server, 0)!.text);
    expect(core.topicReason(["hl7", "fhir"])).toBe(RULES.topic_match(cand(["hl7", "fhir"]), server, 0)!.text);
    const r = core.rank(cat.items, ["hl7", "fhir"], {}, W).find((x) => x.item.full_name === "a/both")!;
    expect(r.reasons[0]).toEqual({ rule: "topic_match", points: 6, text: "2 of your topics (hl7, fhir)" });
    expect(r.reasons.map((x) => x.text)).toContain("MIT licensed");
  });

  test("local marks: Hide removes a repo, More like this nudges similar repos up, Hide nudges them down", () => {
    const skip = core.rank(cat.items, ["hl7"], { "a/hl7": { mark: "skip", topics: ["hl7"], language: "Go" } }, W);
    expect(skip.map((x) => x.item.full_name)).not.toContain("a/hl7");
    expect(skip.find((x) => x.item.full_name === "a/tie")!.score).toBeLessThan(11);
    const keep = core.rank(cat.items, ["hl7"], { "a/both": { mark: "keep", topics: ["hl7", "fhir"], language: "Go" } }, W);
    const both = keep.find((x) => x.item.full_name === "a/both")!;
    // tanh(1/2) on topics (x2), owner and language: 1 x (2 x 0.462 + 0.462 + 0.462) = 1.85
    expect(both.score).toBeCloseTo(8 + 1.8, 0);
    expect(both.reasons.some((x) => x.rule === "feedback" && x.points > 0)).toBe(true);
    const n = core.nudges({ "a/x": { mark: "keep", topics: ["hl7"], language: null }, "b/y": { mark: "keep", topics: ["hl7"], language: null } });
    expect(n.topic.get("hl7")).toBeCloseTo(Math.tanh(1), 6);
  });

  test("stars to topic weights: lift against the catalog, catalog topics only, preselect the strongest", () => {
    const starred = [["hl7", "fhir"], ["hl7"], ["hl7", "zzz"], ["fhir"], ["rust"], ["unlisted"]];
    const w = core.topicWeights(starred, cat);
    // fhir is on fewer stars than hl7 but much rarer in the catalog, so it lifts more.
    expect(w.map((e) => e[0])).toEqual(["fhir", "hl7", "rust"]);
    expect(w[0][1]).toBeGreaterThan(w[1][1]);
    expect(core.suggestTopics(w, 2)).toEqual(["fhir", "hl7"]);
    expect(core.topicWeights([], cat)).toEqual([]);
    // With 20+ stars, a topic needs two of them.
    const many = Array.from({ length: 25 }, (_, i) => (i === 0 ? ["rust"] : i < 4 ? ["hl7"] : []));
    expect(core.topicWeights(many, cat).map((e) => e[0])).toEqual(["hl7"]);
  });

  test("analytics events are fixed names over allow-listed slugs, never free text", () => {
    expect(core.eventName("topic", "hl7")).toBe("pick-topic-hl7");
    expect(core.eventName("pack", "health")).toBe("pick-pack-health");
    expect(core.eventName("stars", "used")).toBe("pick-stars-used");
    for (const [k, v] of [["topic", "octocat's stars"], ["topic", "<x>"], ["pack", "Bad Id"], ["stars", "octocat"], ["user", "octocat"]]) {
      expect(core.eventName(k, v)).toBeNull();
    }
    const js = readFileSync(join(assets, "personalize.js"), "utf8");
    expect([...js.matchAll(/track\("([a-z]+)"/g)].map((m) => m[1]).sort()).toEqual(["pack", "stars", "topic"]);
    expect(js).toContain("if (!cat || !cat.analytics) return;");
  });

  test("summary, dates and numbers", () => {
    expect(core.summaryText(132, ["hl7", "fhir", "mcp", "rust", "go"])).toBe("132 repos for your topics: hl7, fhir, mcp and 2 more.");
    expect(core.summaryText(1, ["hl7"])).toBe("1 repo for your topics: hl7.");
    expect(core.formatDate("2026-11-20T00:00:00.000Z")).toBe("Nov 20, 2026");
    expect(core.formatDate("<x>")).toBe("");
    expect(core.numAttr(Number.NaN)).toBe("0");
    expect(core.numAttr(1e300)).toBe("0");
  });
});
