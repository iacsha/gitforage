import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  GitHub, emptyRevival, forage, isDormant, loadRevival, parseRevival, pointsHere, revivalBudget, revivalQueries, revivalSource,
  revivalText, saveRevival, validateConfig, type RevivalState,
} from "../src/index.ts";
import { NOW, daysAgo, fakeApi, fakeClock, json, rawRepo, repo } from "./helpers.ts";

const rcfg = (rv: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
  validateConfig({ topics: ["hl7"], revival: { enabled: true, ...rv }, ...over });

/**
 * One topic. old/engine: unpushed for 2 years, with a mirror fork (more stars, ahead 0)
 * and a real revival. gone/archived: archived last month, its description points to
 * its fork. quiet/lib: dormant, but its only fork is stale.
 */
function world(o: { dormant?: any[]; archived?: any[]; forks?: Record<string, any[]>; ahead?: Record<string, number> } = {}) {
  const dormant = o.dormant ?? [
    rawRepo("old/engine", { stargazers_count: 900, pushed_at: daysAgo(730), created_at: daysAgo(3000), topics: ["hl7"] }),
    rawRepo("quiet/lib", { stargazers_count: 300, pushed_at: daysAgo(500), created_at: daysAgo(2000) }),
  ];
  const archived = o.archived ?? [
    rawRepo("gone/archived", { stargazers_count: 400, archived: true, pushed_at: daysAgo(30), created_at: daysAgo(2500), description: "Moved: development continues at https://github.com/heir/archived" }),
  ];
  const forks: Record<string, any[]> = o.forks ?? {
    "old/engine": [
      rawRepo("mirror/engine", { fork: true, stargazers_count: 80, created_at: daysAgo(300), pushed_at: daysAgo(5) }),
      rawRepo("carry/engine", { fork: true, stargazers_count: 40, open_issues_count: 12, created_at: daysAgo(400), pushed_at: daysAgo(2) }),
      rawRepo("stale/engine", { fork: true, stargazers_count: 60, created_at: daysAgo(900), pushed_at: daysAgo(800) }),
    ],
    "gone/archived": [rawRepo("heir/archived", { fork: true, stargazers_count: 25, created_at: daysAgo(200), pushed_at: daysAgo(1) })],
    "quiet/lib": [rawRepo("nobody/lib", { fork: true, stargazers_count: 30, created_at: daysAgo(600), pushed_at: daysAgo(400) })],
  };
  const ahead: Record<string, number> = o.ahead ?? { mirror: 0, carry: 37, heir: 5 };
  return fakeApi([
    [/^\/search\/repositories\?q=topic:hl7 stars:>=50 pushed:</, () => json({ items: dormant })],
    [/^\/search\/repositories\?q=topic:hl7 stars:>=50 pushed:>=\S+ archived:true/, () => json({ items: archived })],
    [/^\/repos\/[^/]+\/[^/]+\/forks\?sort=stargazers/, (u) => {
      const up = u.pathname.split("/").slice(2, 4).join("/");
      return json(forks[up] ?? []);
    }],
    [/^\/repos\/[^/]+\/[^/]+\/compare\//, (u) => {
      const owner = /\.\.\.([^:]+):/.exec(decodeURIComponent(u.pathname))![1];
      return json({ ahead_by: ahead[owner] ?? 0, behind_by: 3, status: "diverged" });
    }],
    [/^\/repos\/carry\/engine\/releases/, () => json([{ tag_name: "v2.1.0", published_at: daysAgo(10), draft: false }])],
    [/^\/repos\/[^/]+\/[^/]+\/releases/, () => json([])],
  ]);
}

const client = (fetch: any) => { const c = fakeClock(); return new GitHub({ fetch, sleep: c.sleep, now: c.now }); };

describe("revival radar", () => {
  test("finds the live fork of a dormant upstream and rejects a mirror", async () => {
    const api = world();
    const state = emptyRevival();
    const run = await revivalSource(client(api.fetch), rcfg(), state, NOW);
    const engine = run.items.find((i) => i.upstream.full_name === "old/engine")!;
    expect(engine.fork.full_name).toBe("carry/engine");
    expect(engine.fork.ahead_by).toBe(37);
    expect(engine.fork.release).toEqual({ tag: "v2.1.0", published_at: daysAgo(10) });
    // The mirror has more stars, so it was compared first, and then passed over.
    expect(api.calls.some((c) => c.includes("...mirror:main"))).toBe(true);
    expect(run.items.map((i) => i.fork.full_name)).not.toContain("mirror/engine");
    // A stale fork is never compared; an upstream whose forks are all stale is recorded as checked, with nothing.
    expect(api.calls.some((c) => c.includes("stale:main") || c.includes("nobody:main"))).toBe(false);
    expect(state.checked["quiet/lib"].item).toBeNull();
  });

  test("archived upstream: found by the archived search, and labelled when it points to the fork", async () => {
    const run = await revivalSource(client(world().fetch), rcfg(), emptyRevival(), NOW);
    const gone = run.items.find((i) => i.upstream.full_name === "gone/archived")!;
    expect(gone.upstream.archived).toBe(true);
    expect(gone.fork.full_name).toBe("heir/archived");
    expect(gone.points_here).toBe(true);
    // Upstreams that point here sort first.
    expect(run.items[0].upstream.full_name).toBe("gone/archived");
    expect(run.items.find((i) => i.upstream.full_name === "old/engine")!.points_here).toBe(false);
  });

  test("dormancy and the queries follow the config", () => {
    expect(isDormant(repo("a/b", { pushed_at: daysAgo(400) }), NOW, 12)).toBe(true);
    expect(isDormant(repo("a/b", { pushed_at: daysAgo(200) }), NOW, 12)).toBe(false);
    expect(isDormant(repo("a/b", { pushed_at: daysAgo(200) }), NOW, 6)).toBe(true);
    expect(isDormant(repo("a/b", { pushed_at: daysAgo(1), archived: true }), NOW, 12)).toBe(true);
    const qs = revivalQueries(rcfg({ dormancy_months: 24 }), NOW);
    expect(qs).toHaveLength(2);
    expect(qs[0].q).toMatch(/^topic:hl7 stars:>=50 pushed:<2024-11-\d\d fork:false$/);
    expect(qs[1].q).toContain("archived:true");
  });

  test("an upstream that went active again is not listed (search returns it, dormancy check rejects it)", async () => {
    const api = world({ dormant: [rawRepo("old/engine", { stargazers_count: 900, pushed_at: daysAgo(3) })], archived: [] });
    const run = await revivalSource(client(api.fetch), rcfg(), emptyRevival(), NOW);
    expect(run.items).toEqual([]);
    expect(api.calls.some((c) => c.includes("/forks"))).toBe(false);
  });

  test("renamed or transferred repos: the upstream itself, duplicates and forks older than their parent are ignored", async () => {
    const api = world({
      archived: [],
      dormant: [rawRepo("old/engine", { stargazers_count: 900, pushed_at: daysAgo(730), created_at: daysAgo(1000) })],
      forks: { "old/engine": [
        rawRepo("Old/Engine", { fork: true, stargazers_count: 99, created_at: daysAgo(900), pushed_at: daysAgo(2) }),
        rawRepo("prior/engine", { fork: true, stargazers_count: 90, created_at: daysAgo(2000), pushed_at: daysAgo(2) }),
        rawRepo("carry/engine", { fork: true, stargazers_count: 40, created_at: daysAgo(400), pushed_at: daysAgo(2) }),
      ] },
      ahead: { Old: 50, prior: 50, carry: 4 },
    });
    const run = await revivalSource(client(api.fetch), rcfg(), emptyRevival(), NOW);
    expect(run.items.map((i) => i.fork.full_name)).toEqual(["carry/engine"]);
    expect(api.calls.filter((c) => c.includes("/compare/"))).toHaveLength(1);
  });

  test("a fork without traction, an excluded owner, or with farmed stars is not a revival", async () => {
    const forks = {
      "old/engine": [
        rawRepo("farm/engine", { fork: true, stargazers_count: 60_000, forks_count: 2, open_issues_count: 0, size: 50, created_at: daysAgo(100), pushed_at: daysAgo(2) }),
        rawRepo("spam/engine", { fork: true, stargazers_count: 300, created_at: daysAgo(100), pushed_at: daysAgo(2) }),
        rawRepo("lonely/engine", { fork: true, stargazers_count: 1, open_issues_count: 0, created_at: daysAgo(100), pushed_at: daysAgo(2) }),
      ],
    };
    const api = world({ archived: [], dormant: [rawRepo("old/engine", { stargazers_count: 900, pushed_at: daysAgo(730), created_at: daysAgo(3000) })], forks, ahead: { farm: 9, spam: 9, lonely: 9 } });
    const run = await revivalSource(client(api.fetch), rcfg({}, { exclude: { owners: ["spam"] } }), emptyRevival(), NOW);
    expect(run.items).toEqual([]);
    expect(api.calls.some((c) => c.includes("/compare/"))).toBe(false);
  });

  test("hostile names from the API never reach an API path", async () => {
    const api = world({
      archived: [],
      dormant: [
        rawRepo("../../user", { stargazers_count: 900, pushed_at: daysAgo(730) }),
        rawRepo("evil/x?y=1#z", { stargazers_count: 900, pushed_at: daysAgo(730) }),
        rawRepo("old/engine", { stargazers_count: 800, pushed_at: daysAgo(730), created_at: daysAgo(3000) }),
      ],
      forks: { "old/engine": [rawRepo("<img src=x onerror=alert(1)>/engine", { fork: true, stargazers_count: 99, pushed_at: daysAgo(1), created_at: daysAgo(10) }), rawRepo("carry/engine", { fork: true, stargazers_count: 9, pushed_at: daysAgo(1), created_at: daysAgo(10) })] },
    });
    const run = await revivalSource(client(api.fetch), rcfg(), emptyRevival(), NOW);
    expect(run.items.map((i) => `${i.upstream.full_name} ${i.fork.full_name}`)).toEqual(["old/engine carry/engine"]);
    for (const c of api.calls) expect(c).not.toMatch(/\.\.\/|<img|evil|onerror/);
  });

  test("the call budget is never exceeded, and max_candidates caps fresh upstreams", async () => {
    const dormant = Array.from({ length: 10 }, (_, i) => rawRepo(`up${i}/proj`, { stargazers_count: 1000 - i, pushed_at: daysAgo(800), created_at: daysAgo(3000) }));
    const forks = Object.fromEntries(dormant.map((d) => [d.full_name, [1, 2, 3, 4].map((k) => rawRepo(`f${k}/${d.full_name.split("/")[1]}`, { fork: true, stargazers_count: 50 - k, created_at: daysAgo(100), pushed_at: daysAgo(1) }))]));
    const api = world({ dormant, archived: [], forks, ahead: {} }); // every fork is a mirror: the worst case
    const cfg = rcfg({ max_candidates: 3 });
    const run = await revivalSource(client(api.fetch), cfg, emptyRevival(), NOW);
    expect(run.budget).toBe(revivalBudget(cfg));
    expect(run.budget).toBe(2 + 3 * 5);
    expect(api.calls.length).toBeLessThanOrEqual(run.budget);
    expect(run.calls).toBe(api.calls.length);
    expect(run.examined).toBe(3);
    expect(api.calls.filter((c) => c.includes("/forks"))).toHaveLength(3);
    expect(api.calls.filter((c) => c.includes("/compare/"))).toHaveLength(9);
  });

  test("state: a recent check is reused without API calls; an old one is re-examined", async () => {
    const state = emptyRevival();
    await revivalSource(client(world().fetch), rcfg(), state, NOW);
    expect(Object.keys(state.checked).sort()).toEqual(["gone/archived", "old/engine", "quiet/lib"]);

    const again = world();
    const run = await revivalSource(client(again.fetch), rcfg(), state, NOW + 7 * 86_400_000);
    expect(run.reused).toBe(3);
    expect(run.examined).toBe(0);
    expect(again.calls.every((c) => c.startsWith("/search/"))).toBe(true);
    expect(run.items).toHaveLength(2);

    const later = world();
    const r3 = await revivalSource(client(later.fetch), rcfg(), state, NOW + 30 * 86_400_000);
    expect(r3.examined).toBe(3);
  });

  test("forage puts the radar in its result only when enabled", async () => {
    const off = await forage(validateConfig({ topics: ["hl7"], limits: { rising_per_query: 0 } }), client(world().fetch), { now: NOW });
    expect(off.revival).toBeNull();
    const state = emptyRevival();
    const on = await forage(rcfg({}, { limits: { rising_per_query: 0 } }), client(world().fetch), { now: NOW, revival: state });
    expect(on.revival!.map((i) => i.fork.full_name).sort()).toEqual(["carry/engine", "heir/archived"]);
    expect(on.found.revival).toBe(2);
    expect(state.items).toEqual(on.revival!);
    const skipped = await forage(rcfg(), client(world().fetch), { now: NOW, revival: false });
    expect(skipped.revival).toBeNull();
  });

  test("pointsHere matches links and bare names to the fork only", () => {
    const up = (description: string, homepage = "") => repo("old/engine", { description, homepage });
    expect(pointsHere(up("", "https://github.com/Carry/Engine/"), "carry/engine")).toBe(true);
    expect(pointsHere(up("Unmaintained. Use carry/engine instead."), "carry/engine")).toBe(true);
    expect(pointsHere(up("see github.com/carry/engine.git"), "carry/engine")).toBe(true);
    expect(pointsHere(up("see github.com/carry/engine-extras"), "carry/engine")).toBe(false);
    expect(pointsHere(up("not xcarry/engine"), "carry/engine")).toBe(false);
    expect(pointsHere(up("an engine"), "carry/engine")).toBe(false);
  });

  test("state file round-trips, and hostile entries are dropped on load", () => {
    const dir = mkdtempSync(join(tmpdir(), "gf-revival-"));
    const p = join(dir, "revival.json");
    expect(loadRevival(p)).toEqual({ state: emptyRevival(), problems: [] });
    const good = {
      upstream: { full_name: "old/engine", stars: 900, archived: false, pushed_at: daysAgo(700), topic: "hl7" },
      fork: { full_name: "carry/engine", stars: 40, open_issues: 1, created_at: daysAgo(400), pushed_at: daysAgo(2), ahead_by: 3, behind_by: 0, release: { tag: "v1‮<b>", published_at: daysAgo(3) } },
      points_here: true, checked_at: daysAgo(1),
    };
    const s: RevivalState = { version: 1, generated_at: daysAgo(0), items: [good as any], checked: { "old/engine": { at: daysAgo(1), item: good as any }, "quiet/lib": { at: daysAgo(1), item: null } } };
    saveRevival(p, s);
    const back = loadRevival(p);
    expect(back.problems).toEqual([]);
    expect(back.state.items[0].fork.release!.tag).toBe("v1<b>"); // controls and bidi stripped; HTML escaping is the renderer's job
    expect(back.state.checked["quiet/lib"].item).toBeNull();

    const hostile = {
      version: 1, generated_at: "x", checked: { "../etc": { at: daysAgo(1), item: null } },
      items: [
        { ...good, upstream: { ...good.upstream, full_name: "a/<script>" } },
        { ...good, fork: { ...good.fork, full_name: "javascript:alert(1)/x" } },
        { ...good, fork: { ...good.fork, ahead_by: 0 } },
        { ...good, fork: { ...good.fork, full_name: "old/engine" } },
        { ...good, upstream: { ...good.upstream, topic: "<b>" }, points_here: "yes" },
      ],
    };
    writeFileSync(p, JSON.stringify(hostile));
    const r = loadRevival(p);
    expect(r.state.items).toHaveLength(1);
    expect(r.state.items[0].upstream.topic).toBe("");
    expect(r.state.items[0].points_here).toBe(false);
    expect(r.state.checked).toEqual({});
    expect(r.problems.length).toBe(5);
    expect(parseRevival("{nope").problems[0]).toContain("not valid JSON");
  });

  test("revivalText for the terminal", () => {
    const t = revivalText([{
      upstream: { full_name: "old/engine", stars: 9, archived: true, pushed_at: daysAgo(30), topic: "hl7" },
      fork: { full_name: "carry/engine", stars: 4, open_issues: 0, created_at: daysAgo(9), pushed_at: "2026-11-18T00:00:00.000Z", ahead_by: 7, behind_by: 0, release: null },
      points_here: true, checked_at: daysAgo(0),
    }]);
    expect(t).toContain("old/engine (archived) -> carry/engine: 7 ahead, pushed 2026-11-18, 4 stars, upstream points here");
  });
});

describe("revival config", () => {
  test("defaults, validation and the topics requirement", () => {
    expect(validateConfig({ topics: ["a"] }).revival).toEqual({ enabled: false, dormancy_months: 12, max_candidates: 10, min_fork_stars: 5 });
    expect(rcfg({ dormancy_months: 18, max_candidates: 4 }).revival).toMatchObject({ enabled: true, dormancy_months: 18, max_candidates: 4 });
    expect(() => rcfg({ dormancy_months: 1 })).toThrow(/revival.dormancy_months: must be between 3 and 120/);
    expect(() => rcfg({ max_candidates: 500 })).toThrow(/revival.max_candidates/);
    expect(() => rcfg({ enable: true })).toThrow(/revival.enable: unknown key \(did you mean "enabled"\?\)/);
    expect(() => rcfg({ enabled: "yes" })).toThrow(/revival.enabled: must be true or false/);
    expect(() => validateConfig({ seeds: ["a/b"], revival: { enabled: true } })).toThrow(/needs topics/);
  });
});
