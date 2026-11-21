import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  crossedMilestones, earlyFinds, earlyFindsJson, emptyEarlyFinds, GitHub, leadDays, loadEarlyFinds, median, parseEarlyFinds, parseHn, parseTrending,
  saveEarlyFinds, trackingSince, updateEarlyFinds, validateConfig, validateEarlyFinds, type EarlyFindsLedger, type SeenState, type WebFetch,
} from "../src/index.ts";

const NOW = Date.parse("2026-12-10T12:00:00Z");
const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 1000;

describe("reading the ledger", () => {
  test("a hostile ledger keeps only plain names, real dates and bounded numbers", () => {
    const { ledger, problems } = validateEarlyFinds({
      version: 1,
      updated: "2026-12-01T00:00:00.000Z",
      repos: {
        "good/repo": {
          first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20", stars_at_first_seen: 120, trending_first: "2026-12-01",
          hn_first: { date: "2026-12-02", id: 42, points: 300 }, milestones: { "1000": "2026-12-03", "777": "2026-12-03", "5000": "not a date" },
          stars_last: 1200, checked: "2026-12-03T10:00:00.000Z", url: "javascript:alert(1)", evil: "<script>",
        },
        "Mixed/Case": { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20", stars_last: -1, stars_at_first_seen: 1e12, trending_first: "2026-02-30" },
        "../etc": { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20" },
        "a/b/c": { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20" },
        "<img onerror=x>/y": { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20" },
        "no/firstseen": { tracked_since: "2026-11-20" },
        "bad/dates": { first_seen: "yesterday", tracked_since: "2026-11-20" },
        "far/future": { first_seen: "2199-01-01T00:00:00.000Z", tracked_since: "2026-11-20" },
        "neg/stars": { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20", stars_last: -5, hn_first: { date: "2026-12-01", id: -1, points: 3 } },
        "mixed/case": { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20" },
        "arr/entry": [],
      },
    });
    expect(Object.keys(ledger.repos).sort()).toEqual(["good/repo", "mixed/case", "neg/stars"]);
    expect(ledger.repos["good/repo"]).toEqual({
      first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20", stars_at_first_seen: 120, trending_first: "2026-12-01",
      hn_first: { date: "2026-12-02", id: 42, points: 300 }, milestones: { "1000": "2026-12-03" }, stars_last: 1200, checked: "2026-12-03T10:00:00.000Z",
    });
    // The first of two names that differ only in case wins; out-of-range values and impossible dates are dropped.
    expect(ledger.repos["mixed/case"]).toEqual({ first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20", stars_last: -1 });
    expect(ledger.repos["neg/stars"]).toEqual({ first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20" });
    expect(problems.length).toBe(8);
    expect(problems.join("\n")).not.toContain("<img");
  });

  test("the wrong shape, bad JSON and oversized files are refused whole", () => {
    expect(parseEarlyFinds("{").problems[0]).toContain("not valid JSON");
    expect(parseEarlyFinds(JSON.stringify({ version: 2, repos: {} })).problems[0]).toContain("expected");
    expect(parseEarlyFinds(JSON.stringify({ version: 1, repos: [] })).ledger).toEqual(emptyEarlyFinds());
    expect(parseEarlyFinds("x".repeat(17 * 1024 * 1024)).problems[0]).toContain("larger than");
  });

  test("saves with sorted keys and loads back the same", () => {
    const dir = mkdtempSync(join(tmpdir(), "gf-ef-"));
    const p = join(dir, "state", "early-finds.json");
    expect(loadEarlyFinds(p)).toEqual({ ledger: emptyEarlyFinds(), problems: [] });
    const l: EarlyFindsLedger = { version: 1, updated: "2026-12-01T00:00:00.000Z", repos: {
      "z/z": { tracked_since: "2026-11-21", first_seen: "2026-11-21T00:00:00.000Z", stars_last: 3, checked: "2026-12-01T00:00:00.000Z" },
      "a/a": { tracked_since: "2026-11-20", first_seen: "2026-11-20T00:00:00.000Z" },
    } };
    saveEarlyFinds(p, l);
    const text = readFileSync(p, "utf8");
    expect(text).toBe(earlyFindsJson(l));
    expect(text.indexOf('"a/a"')).toBeLessThan(text.indexOf('"z/z"'));
    const z = text.slice(text.indexOf('"z/z"'));
    expect(z.indexOf('"checked"')).toBeLessThan(z.indexOf('"first_seen"'));
    expect(z.indexOf('"first_seen"')).toBeLessThan(z.indexOf('"tracked_since"'));
    expect(text.indexOf('"repos"')).toBeLessThan(text.indexOf('"updated"'));
    expect(loadEarlyFinds(p)).toEqual({ ledger: l, problems: [] });
  });
});

describe("lead math", () => {
  const e = { first_seen: "2026-11-20T23:30:00.000Z", tracked_since: "2026-11-20" };

  test("only days strictly after first shown (and after the first watched day) count", () => {
    expect(leadDays(e, "2026-11-19")).toBeNull(); // negative
    expect(leadDays(e, "2026-11-20")).toBeNull(); // zero: same day
    expect(leadDays(e, "2026-11-21")).toBe(1);
    expect(leadDays(e, "2026-12-20")).toBe(30);
    // Tracking began long after it was shown: its first watched day proves nothing.
    const late = { first_seen: "2026-10-01T00:00:00.000Z", tracked_since: "2026-11-20" };
    expect(leadDays(late, "2026-11-20")).toBeNull();
    expect(leadDays(late, "2026-11-21")).toBe(51);
    expect(leadDays(e, "garbage")).toBeNull();
  });

  test("finds take the earliest qualifying event; repos already big when shown are not finds", () => {
    const l: EarlyFindsLedger = { version: 1, updated: "", repos: {
      "early/trend": { ...e, trending_first: "2026-12-05", hn_first: { date: "2026-12-01", id: 1, points: 200 } },
      "same/day": { ...e, trending_first: "2026-11-20" },
      "before/shown": { ...e, hn_first: { date: "2026-11-18", id: 2, points: 50 } },
      "already/big": { ...e, stars_at_first_seen: 12000, milestones: { "1000": "2026-12-01", "5000": "2026-12-01", "10000": "2026-12-01", "25000": "2026-12-08" } },
      "never/did": { ...e, stars_at_first_seen: 40, stars_last: 60 },
    } };
    const f = earlyFinds(l);
    expect(f.map((x) => x.name)).toEqual(["already/big", "early/trend"]);
    expect(f[0].events).toEqual([{ kind: "stars", date: "2026-12-08", lead: 18, milestone: 25000 }]);
    expect(f[1].events.map((x) => [x.kind, x.lead])).toEqual([["hn", 11], ["trending", 15]]);
    expect(trackingSince(l)).toBe("2026-11-20");
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  test("milestones count only when crossed after the first check", () => {
    expect(crossedMilestones(800, 1000)).toEqual(["1000"]);
    expect(crossedMilestones(800, 12000)).toEqual(["1000", "5000", "10000"]);
    expect(crossedMilestones(1000, 4999)).toEqual([]);
    expect(crossedMilestones(60000, 70000)).toEqual([]);
  });
});

describe("parsing the outside sources", () => {
  test("Trending: only plain owner/repo names, lowercased, de-duplicated", () => {
    const row = (href: string) => `<article class="Box-row"><h2 class="h3 lh-condensed">\n  <a data-view-component="true" href="${href}" class="Link">x</a></h2></article>`;
    const page = [
      row("/Good/Repo"), row("/good/repo"), row("/other/tool?since=daily"), row("/../../etc/passwd"), row("/a/b/c"), row("/javascript:alert(1)/x"),
      row("/x/%3Cscript%3E"), row('/q/"onmouseover=alert(1)'), row("/./.."), row("/sponsors/someone"), row("/<img>/y"),
      `<h2 class="something-else"><a href="/not/trending"></a></h2>`,
    ].join("\n");
    expect(parseTrending(page)).toEqual(["good/repo", "other/tool", "sponsors/someone"]);
    expect(parseTrending("<html>nothing here</html>")).toEqual([]);
  });

  test("HN: github.com repo links only, earliest story per repo, numbers bounded", () => {
    const hits = { hits: [
      { url: "https://github.com/Acme/Tool", created_at_i: day("2026-12-03"), objectID: "100", points: 250 },
      { url: "https://github.com/acme/tool/tree/main", created_at_i: day("2026-12-02"), objectID: "99", points: 120 },
      { url: "https://www.github.com/x/y.git", created_at_i: day("2026-12-02"), objectID: "101", points: "lots" },
      { url: "https://github.com/x", created_at_i: day("2026-12-02"), objectID: "102", points: 1 },
      { url: "https://evil.example/github.com/a/b", created_at_i: day("2026-12-02"), objectID: "103", points: 1 },
      { url: "https://github.com/../../x", created_at_i: day("2026-12-02"), objectID: "104", points: 1 },
      { url: "https://github.com/a/b", created_at_i: "soon", objectID: "105", points: 1 },
      { url: "https://github.com/c/d", created_at_i: day("2026-12-02"), objectID: "-3", points: 1 },
      { url: "javascript:alert(1)", created_at_i: day("2026-12-02"), objectID: "106", points: 1 },
      null, "junk", { url: 5 },
    ] };
    expect(parseHn(hits)).toEqual([
      { name: "acme/tool", date: "2026-12-02", id: 99, points: 120 },
      { name: "x/y", date: "2026-12-02", id: 101, points: 0 },
    ]);
    expect(parseHn(null)).toEqual([]);
    expect(parseHn({ hits: "no" })).toEqual([]);
  });
});

describe("updateEarlyFinds", () => {
  const seen: SeenState = { version: 1, seen: {
    "acme/tool": { first_seen: "2026-11-22T10:00:00.000Z", score: 5 },
    "small/lib": { first_seen: "2026-11-22T10:00:00.000Z", score: 4 },
    "gone/repo": { first_seen: "2026-11-22T10:00:00.000Z", score: 3 },
    "../bad": { first_seen: "2026-11-22T10:00:00.000Z", score: 3 },
    "new/today": { first_seen: "2026-12-10T08:00:00.000Z", score: 3 },
  } };
  const trendingHtml = `<h2 class="h3 lh-condensed"><a href="/acme/tool">acme / tool</a></h2><h2 class="h3 lh-condensed"><a href="/new/today">n</a></h2><h2 class="h3 lh-condensed"><a href="/untracked/x">u</a></h2>`;
  const hn = { hits: [{ url: "https://github.com/small/lib", created_at_i: day("2026-12-09"), objectID: "7", points: 140 }] };

  const web = (urls: string[], o: { trending?: Response; hn?: Response } = {}): WebFetch => async (url, init) => {
    urls.push(url);
    expect(init.signal).toBeDefined();
    if (url.startsWith("https://github.com/trending")) return o.trending ?? new Response(trendingHtml);
    if (url.startsWith("https://hn.algolia.com/")) return o.hn ?? new Response(JSON.stringify(hn));
    throw new Error(`unexpected ${url}`);
  };
  const api = (stars: Record<string, number>, paths: string[]) => async (url: string) => {
    const p = new URL(url).pathname;
    paths.push(p);
    const k = p.replace("/repos/", "");
    if (!(k in stars)) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return new Response(JSON.stringify({ full_name: k, stargazers_count: stars[k] }), { status: 200 });
  };

  test("adds from seen, records Trending, HN and milestones, and credits only later days", async () => {
    const urls: string[] = [], paths: string[] = [];
    const l = emptyEarlyFinds();
    // Day one: everything shown so far is added and checked; acme/tool is trending on its first watched day.
    // new/today was first shown after this run, so it waits.
    const gh1 = new GitHub({ fetch: api({ "acme/tool": 900, "small/lib": 30, "new/today": 5 }, paths) as any });
    const r1 = await updateEarlyFinds(gh1, seen, l, Date.parse("2026-11-23T07:00:00Z"), web(urls, { hn: new Response('{"hits": []}') }));
    expect(r1).toMatchObject({ added: 3, tracked: 3, trendingToday: 3, trendingHits: 1, hnHits: 0, checked: 3, crossed: 0, warnings: [] });
    expect(paths.sort()).toEqual(["/repos/acme/tool", "/repos/gone/repo", "/repos/small/lib"]);
    expect(l.repos["gone/repo"].stars_last).toBe(-1);
    expect(l.repos["acme/tool"]).toMatchObject({ tracked_since: "2026-11-23", trending_first: "2026-11-23", stars_at_first_seen: 900 });
    expect(urls[1]).toContain("tags=front_page");
    expect(earlyFinds(l)).toEqual([]); // trending on the first watched day proves nothing

    // Two weeks on: acme/tool crossed 1k, small/lib hit the HN front page.
    const gh2 = new GitHub({ fetch: api({ "acme/tool": 1500, "small/lib": 31, "new/today": 5 }, paths) as any });
    const r2 = await updateEarlyFinds(gh2, seen, l, NOW, web(urls));
    // new/today is added and trending, but on its first watched day, so it is no find.
    expect(r2).toMatchObject({ added: 1, trendingHits: 1, hnHits: 1, crossed: 1 });
    expect(l.repos["acme/tool"].milestones).toEqual({ "1000": "2026-12-10" });
    expect(l.repos["acme/tool"].stars_at_first_seen).toBe(900);
    expect(l.repos["small/lib"].hn_first).toEqual({ date: "2026-12-09", id: 7, points: 140 });
    expect(earlyFinds(l).map((f) => [f.name, f.events[0].kind, f.events[0].lead])).toEqual([["acme/tool", "stars", 18], ["small/lib", "hn", 17]]);
    expect(l.updated).toBe(new Date(NOW).toISOString());
  });

  test("Trending or HN failing is a warning, and star checks still run", async () => {
    const l = emptyEarlyFinds();
    const gh = new GitHub({ fetch: api({ "acme/tool": 10 }, []) as any });
    const r = await updateEarlyFinds(gh, seen, l, NOW, web([], { trending: new Response("busy", { status: 503 }), hn: new Response("<html>") }));
    expect(r.trendingToday).toBeNull();
    expect(r.warnings.join("\n")).toContain("Trending skipped: github.com answered 503");
    expect(r.warnings.join("\n")).toContain("Hacker News skipped: HN answered with something that is not JSON");
    expect(r.checked).toBe(4);
  });

  test("oversized responses are refused", async () => {
    const l = emptyEarlyFinds();
    const gh = new GitHub({ fetch: api({}, []) as any });
    const big = new Response("x".repeat(5 * 1024 * 1024));
    const r = await updateEarlyFinds(gh, seen, l, NOW, web([], { trending: big }));
    expect(r.warnings.join("\n")).toContain("too large");
  });

  test("checks at most 400 repos a run, least recently checked first, and skips ones checked in the last 6 days", async () => {
    const many: SeenState = { version: 1, seen: {} };
    for (let i = 0; i < 450; i++) many.seen[`o/r${i}`] = { first_seen: "2026-11-01T00:00:00.000Z", score: 1 };
    const l = emptyEarlyFinds();
    const paths: string[] = [];
    const gh = new GitHub({ fetch: (async (u: string) => { paths.push(u); return new Response(JSON.stringify({ stargazers_count: 1 })); }) as any });
    const r1 = await updateEarlyFinds(gh, many, l, NOW, web([]));
    expect(r1.checked).toBe(400);
    const r2 = await updateEarlyFinds(gh, many, l, NOW + 86_400_000, web([]));
    expect(r2.checked).toBe(50);
    const r3 = await updateEarlyFinds(gh, many, l, NOW + 2 * 86_400_000, web([]));
    expect(r3.checked).toBe(0);
  });
});

describe("config", () => {
  test("early_finds is off by default, strict, and only has enabled", () => {
    expect(validateConfig({ topics: ["hl7"] }).early_finds).toEqual({ enabled: false });
    expect(validateConfig({ topics: ["hl7"], early_finds: { enabled: true } }).early_finds).toEqual({ enabled: true });
    expect(() => validateConfig({ topics: ["hl7"], early_finds: { enabled: "yes" } })).toThrow("early_finds.enabled");
    expect(() => validateConfig({ topics: ["hl7"], early_finds: { enabled: true, extra: 1 } })).toThrow("early_finds.extra");
    expect(() => validateConfig({ topics: ["hl7"], early_finds: [] })).toThrow();
  });
});

describe("importing the prototype ledger", () => {
  test("converts the old format, derives tracked_since from the earliest check, and drops bad entries", async () => {
    const { importPrototype } = await import("../../../scripts/import-early-finds.ts");
    const r = importPrototype({ version: 1, updated: "2026-11-21T14:24:03.775Z", repos: {
      "old/one": { first_seen: "2026-11-01T10:00:00.000Z", stars_at_first_seen: 900, trending_first: "2026-11-25", milestones: { "1000": "2026-11-26" }, stars_last: 1100, checked: "2026-11-26T10:00:00.000Z" },
      "new/two": { first_seen: "2026-11-23T10:00:00.000Z", hn_first: { date: "2026-11-24", id: 5, points: 99 }, checked: "2026-11-20T09:00:00.000Z" },
      "../evil": { first_seen: "2026-11-01T10:00:00.000Z" },
      "no/date": { stars_last: 3 },
      "<b>/x": "junk",
    } });
    expect(r.read).toBe(5);
    expect(r.start).toBe("2026-11-20");
    expect(r.dropped.length).toBe(3);
    expect(r.ledger.repos["old/one"]).toMatchObject({ tracked_since: "2026-11-20", milestones: { "1000": "2026-11-26" } });
    expect(r.ledger.repos["new/two"].tracked_since).toBe("2026-11-23");
    expect(earlyFinds(r.ledger).map((f) => [f.name, f.events[0].lead])).toEqual([["old/one", 24], ["new/two", 1]]);
    expect(() => importPrototype({ version: 2 })).toThrow("not a prototype ledger");
  });
});
