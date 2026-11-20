import { describe, expect, test } from "bun:test";
import { GitHub, withMode, forage, isLiveFork, kinQueries, searchQueries, toMarkdown, countOutsidePrs, issueResponse } from "../src/index.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { profileCounts, profileFrom } from "../src/index.ts";
import { NOW, cfg, daysAgo, fakeApi, fakeClock, json, rawRepo, repo } from "./helpers.ts";

/** A small recorded-style GitHub: one seed, a few searches, forks and stargazers. */
/** How many repos on "GitHub" match each term, for the profile's lift. Unlisted terms: 1,000,000. */
export const DF: Record<string, number> = { hl7: 3_000, mllp: 200, "interface-engine": 400, docker: 2_000_000, engine: 900_000 };

function world(over: { searchFails?: boolean; kinItems?: any[] } = {}) {
  return fakeApi([
    [/^\/users\/me\/starred\?per_page=100&page=1$/, () => json([
      rawRepo("known/starred", { topics: ["hl7", "mllp"] }),
      rawRepo("known/two", { topics: ["hl7", "mllp", "interface-engine"] }),
      rawRepo("known/three", { topics: ["docker", "interface-engine"] }),
      rawRepo("known/four", { topics: ["docker"] }),
    ])],
    [/^\/search\/repositories\?q="([a-z0-9+#-]+)"&per_page=1$/, (u) => {
      const term = /"([^"]+)"/.exec(decodeURIComponent(u.search))![1];
      return json({ total_count: DF[term] ?? 1_000_000, items: [] });
    }],
    [/^\/search\/repositories\?q="[a-z0-9+#-]+" "[a-z0-9+#-]+" stars:/, () => json({ items: over.kinItems ?? [
      rawRepo("kin/shared", { stargazers_count: 70, topics: ["hl7", "mllp"] }),
      rawRepo("kin/solo", { topics: ["docker"] }),
      rawRepo("viral/word-thing", { stargazers_count: 19_000, created_at: daysAgo(40), description: "an AI writing app" }),
    ] })],
    [/^\/repos\/acme\/engine\/readme$/, () => json({ encoding: "base64", content: Buffer.from("# Engine\nAn HL7 MLLP interface engine. <script>alert(1)</script> \u202e [x](javascript:alert(1)) \u0000 \x1b[31m").toString("base64") })],
    [/^\/search\/repositories\?q=topic:hl7 /, () => over.searchFails
      ? json({ message: "Validation Failed" }, 422)
      : json({ items: [
        rawRepo("new/hl7tool", { topics: ["hl7", "mllp"], created_at: daysAgo(60), stargazers_count: 50 }),
        rawRepo("known/starred"),
        rawRepo("x/awesome-hl7", { stargazers_count: 900 }),
      ] })],
    [/^\/search\/repositories\?q="MLLP" in:name,description,readme /, () => json({ items: [
      rawRepo("new/hl7tool", { topics: ["hl7"], created_at: daysAgo(60), stargazers_count: 50 }),
      rawRepo("tiny/mllp-relay", { stargazers_count: 2 }),
    ] })],
    [/^\/search\/repositories/, () => json({ items: [] })],
    [/^\/repos\/acme\/engine$/, () => json(rawRepo("acme/engine", { stargazers_count: 40, default_branch: "develop", topics: ["hl7", "mllp"] }))],
    [/^\/repos\/acme\/engine\/forks\?sort=newest/, () => json([
      rawRepo("live/engine", { fork: true, stargazers_count: 0, created_at: daysAgo(100), pushed_at: daysAgo(2) }),
      rawRepo("never/engine", { fork: true, created_at: daysAgo(5), pushed_at: daysAgo(5) }),
      rawRepo("stale/engine", { fork: true, created_at: daysAgo(900), pushed_at: daysAgo(400) }),
    ])],
    [/^\/repos\/acme\/engine\/forks\?sort=stargazers/, () => json([
      rawRepo("live/engine", { fork: true, stargazers_count: 0, created_at: daysAgo(100), pushed_at: daysAgo(2) }),
      rawRepo("even/engine", { fork: true, created_at: daysAgo(50), pushed_at: daysAgo(10) }),
    ])],
    [/^\/repos\/acme\/engine\/compare\/develop\.\.\.live:main/, () => json({ ahead_by: 12, behind_by: 3 })],
    [/^\/repos\/acme\/engine\/compare\/develop\.\.\.even:main/, () => json({ ahead_by: 0, behind_by: 9 })],
    [/\/community\/profile$/, (u) => u.pathname.includes("new/hl7tool") ? json({ files: { contributing: { url: "x" } } }) : json({ files: {} })],
    [/\/issues\?state=open&labels=good first issue/, () => json([{ number: 1 }, { number: 2, pull_request: {} }])],
    [/\/issues\?state=open&labels=help wanted/, () => json([])],
    [/\/issues\?state=all/, () => json([
      { created_at: daysAgo(10), comments: 2, state: "open", user: { type: "User" } },
      { created_at: daysAgo(10), comments: 0, state: "closed", user: { type: "User" } },
      { created_at: daysAgo(10), comments: 0, state: "open", user: { type: "User" } },
      { created_at: daysAgo(1), comments: 0, state: "open", user: { type: "User" } },
    ])],
    [/\/releases\?per_page=1$/, (u) => u.pathname.includes("new/hl7tool") ? json([{ tag_name: "v0.3.0", published_at: daysAgo(4) }]) : json([])],
    [/^\/search\/issues/, () => json({ items: [
      { author_association: "CONTRIBUTOR", user: { type: "User" } },
      { author_association: "FIRST_TIME_CONTRIBUTOR", user: { type: "User" } },
      { author_association: "OWNER", user: { type: "User" } },
      { author_association: "NONE", user: { type: "Bot" } },
    ] })],
  ]);
}

const config = () => cfg({
  topics: ["hl7", "fhir"], keywords: ["MLLP"], seeds: ["acme/engine"], stars_from: "me",
  exclude: { keywords: ["awesome-"] }, limits: { kin_min_overlap: 2 }, mode: "contribute",
});

describe("forage pipeline (fake API)", () => {
  test("finds, excludes, scores and ranks across all three sources", async () => {
    const api = world();
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    const res = await forage(config(), gh, { now: NOW });

    expect(res.warnings).toEqual([]);
    const names = res.ranked.map((s) => s.candidate.repo.full_name);
    expect(names).toEqual(["new/hl7tool", "kin/shared", "live/engine"]);

    expect(res.excluded).toContainEqual({ full_name: "known/starred", reason: "already in your seeds or stars" });
    expect(res.excluded).toContainEqual({ full_name: "x/awesome-hl7", reason: 'excluded keyword "awesome-"' });
    expect(res.excluded).toContainEqual({ full_name: "tiny/mllp-relay", reason: "under min_stars (2)" });

    const [tool, kin, fork] = res.ranked;
    expect(tool.candidate.sources).toEqual(["search"]);
    expect(tool.candidate.via_topics).toEqual(["hl7"]);
    expect(tool.candidate.via_keywords).toEqual(["MLLP"]);
    expect(tool.candidate.signals).toEqual({
      readme: false, contributing: true, latest_release: { tag: "v0.3.0", published_at: daysAgo(4) },
      issue_response: { answered: 2, total: 3 }, good_first_issues: 1, help_wanted: 0, outside_prs_90d: 2,
    });
    expect(tool.reasons.map((r) => r.rule)).toContain("outside_prs");

    expect(fork.candidate.fork).toEqual({ upstream: "acme/engine", ahead_by: 12, behind_by: 3 });
    expect(fork.reasons[0].text).toBe("live fork of acme/engine: 12 commits ahead, 3 behind");

    expect(kin.candidate.sources).toEqual(["kin"]);
    expect(kin.candidate.kin!.queries[0]).toBe("hl7 + mllp");
    expect(kin.candidate.affinity).toEqual({ shared: ["mllp", "hl7"], fit: 1.804 });
    expect(kin.reasons.map((r) => r.text)).toContain("like your stars: mllp, hl7");
    // One profile term is not enough, and a viral repo that shares none is never kin.
    expect(names).not.toContain("kin/solo");
    expect(names).not.toContain("viral/word-thing");
    // The search hit also carries your profile terms.
    expect(tool.candidate.affinity!.shared).toEqual(["mllp", "hl7"]);
    // Profile: mllp and hl7 are rare on GitHub and common in your stars; docker is the reverse.
    expect(res.profile.map((t) => t.term)).toEqual(["mllp", "hl7", "interface-engine", "docker"]);
    expect(res.profile.at(-1)!.weight).toBeLessThan(0.2);

    // Never-pushed, stale and not-ahead forks cost no compare (or are dropped after it).
    expect(api.calls.some((c) => c.includes("never:main") || c.includes("stale:main"))).toBe(false);
    expect(api.calls.filter((c) => c.includes("/compare/")).length).toBe(2);
    // Kin never reads stargazer, contributor or other people's star lists.
    expect(api.calls.some((c) => /\/stargazers|\/contributors/.test(c))).toBe(false);
    expect(api.calls.filter((c) => c.startsWith("/users/")).every((c) => c.startsWith("/users/me/starred?per_page=100"))).toBe(true);
  });

  test("discover mode fetches no contributor signals", async () => {
    const api = world();
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    const res = await forage(withMode(config(), "discover"), gh, { now: NOW });
    expect(api.calls.some((c) => c.startsWith("/search/issues"))).toBe(false);
    expect(api.calls.some((c) => c.includes("labels=") || c.includes("state=all"))).toBe(false);
    const tool = res.ranked.find((s) => s.candidate.repo.full_name === "new/hl7tool")!;
    expect(tool.candidate.signals).toEqual({ readme: false, contributing: true, latest_release: { tag: "v0.3.0", published_at: daysAgo(4) } });
    expect(tool.reasons.map((r) => r.text)).toContain("released v0.3.0 4d ago");
    expect(tool.reasons.map((r) => r.rule)).not.toContain("contributing");
  });

  test("kin: term pairs from your stars become searches; term counts are cached for 30 days", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-kin-"));
    const api = world();
    const clock = fakeClock();
    await forage(config(), new GitHub({ fetch: api.fetch, cacheDir: dir, ttlMs: 3_600_000, ...clock }), { now: NOW });
    const dfCalls = () => api.calls.filter((c) => /^\/search\/repositories\?q="[^"]+"&per_page=1$/.test(c)).length;
    expect(dfCalls()).toBe(4);
    const kinCalls = api.calls.filter((c) => /q="[^"]+" "[^"]+" stars:5\.\.20000 pushed:>=2026-05-24 fork:false/.test(c));
    expect(kinCalls.length).toBeGreaterThan(0);
    // Two days later the hourly cache has expired, but the term counts have not.
    clock.advance(2 * 86_400_000);
    await forage(config(), new GitHub({ fetch: api.fetch, cacheDir: dir, ttlMs: 3_600_000, ...clock }), { now: NOW });
    expect(dfCalls()).toBe(4);
    expect(api.calls.filter((c) => c.startsWith("/users/me/starred")).length).toBe(2);
  });

  test("kin: hostile README text only ever becomes plain tokens", async () => {
    const items = [rawRepo("kin/shared", { stargazers_count: 70, topics: ["hl7", "mllp"] })];
    const api = world({ kinItems: items });
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    const res = await forage(config(), gh, { now: NOW });
    for (const t of res.profile) expect(t.term).toMatch(/^[a-z0-9][a-z0-9+#-]*$/);
  });

  test("kin skips repos above kin_max_stars", async () => {
    const c = config();
    c.limits.kin_max_stars = 50;
    const res = await forage(c, new GitHub({ fetch: world().fetch, ...fakeClock() }), { now: NOW });
    expect(res.ranked.map((s) => s.candidate.repo.full_name)).not.toContain("kin/shared");
  });

  test("skip (seen) removes repos before signals are fetched", async () => {
    const api = world();
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    const res = await forage(config(), gh, { now: NOW, skip: new Set(["new/hl7tool"]) });
    expect(res.ranked.map((s) => s.candidate.repo.full_name)).toEqual(["kin/shared", "live/engine"]);
    expect(res.skipped_seen).toBe(1);
    expect(api.calls.some((c) => c.includes("new/hl7tool/community"))).toBe(false);
  });

  test("signals only for the top N", async () => {
    const api = world();
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    const c = config();
    c.limits.signals_top = 1;
    const res = await forage(c, gh, { now: NOW });
    expect(res.ranked.filter((s) => s.candidate.signals).length).toBe(1);
    expect(api.calls.filter((x) => x.includes("/community/profile")).length).toBe(1);
  });

  test("a failing source becomes a warning; the others still run", async () => {
    const gh = new GitHub({ fetch: world({ searchFails: true }).fetch, ...fakeClock() });
    const res = await forage(config(), gh, { now: NOW });
    expect(res.warnings[0]).toStartWith("search source failed: GitHub 422");
    expect(res.ranked.map((s) => s.candidate.repo.full_name)).toEqual(["kin/shared", "live/engine"]);
  });

  test("renders markdown with a table and per-repo reasons", async () => {
    const gh = new GitHub({ fetch: world().fetch, ...fakeClock() });
    const res = await forage(config(), gh, { now: NOW });
    const md = toMarkdown(res.ranked, { date: "2026-11-20" });
    expect(md).toStartWith("# gitforage digest (2026-11-20)");
    expect(md).toContain("| 1 |");
    expect(md).toContain("[new/hl7tool](https://github.com/new/hl7tool)");
    expect(md).toContain("- +7.4 live fork of acme/engine: 12 commits ahead, 3 behind");
    expect(toMarkdown([], { date: "x" })).toContain("Nothing new this time.");
  });
});

describe("source helpers", () => {
  test("search queries carry created and stars filters", () => {
    const q = searchQueries(cfg({ filters: { min_stars: 7, max_age_days: 30 } }), NOW);
    expect(q[0]).toEqual({ kind: "topic", term: "hl7", q: "topic:hl7 created:>=2026-10-21 stars:>=7 archived:false" });
    expect(q.at(-1)!.q).toStartWith('"MLLP" in:name,description,readme created:>=2026-10-21');
  });

  test("keyword quotes are stripped so they cannot break the query", () => {
    const q = searchQueries(cfg({ keywords: ['say "hi"'] }), NOW);
    expect(q.at(-1)!.q).toStartWith('"say hi" in:');
  });

  test("live fork filter", () => {
    expect(isLiveFork(repo("a/b", { created_at: daysAgo(30), pushed_at: daysAgo(1) }), NOW, 180)).toBe(true);
    expect(isLiveFork(repo("a/b", { created_at: daysAgo(30), pushed_at: daysAgo(30) }), NOW, 180)).toBe(false);
    expect(isLiveFork(repo("a/b", { created_at: daysAgo(900), pushed_at: daysAgo(200) }), NOW, 180)).toBe(false);
    expect(isLiveFork(repo("a/b", { created_at: daysAgo(30), pushed_at: daysAgo(1), archived: true }), NOW, 180)).toBe(false);
  });

  test("kin queries quote both terms and carry the star band and push age", () => {
    const profile = profileFrom(profileCounts([
      { repo: repo("a/one", { topics: ["hl7", "mllp"] }), weight: 1 },
      { repo: repo("a/two", { topics: ["hl7", "mllp"] }), weight: 1 },
    ], 10), new Map([["hl7", 3000], ["mllp", 200]]));
    expect(kinQueries(profile, cfg({ limits: { kin_max_stars: 0 } }), NOW)).toEqual([
      { label: "hl7 + mllp", q: '"hl7" "mllp" stars:>=5 pushed:>=2026-05-24 fork:false archived:false' },
    ]);
  });

  test("issue response skips PRs, bots and issues under 2 days old", () => {
    expect(issueResponse([
      { created_at: daysAgo(5), comments: 1, user: { type: "User" } },
      { created_at: daysAgo(5), comments: 0, state: "open", user: { type: "User" } },
      { created_at: daysAgo(5), comments: 3, pull_request: {} },
      { created_at: daysAgo(5), comments: 3, user: { type: "Bot" } },
      { created_at: daysAgo(1), comments: 0, user: { type: "User" } },
    ], NOW)).toEqual({ answered: 1, total: 2 });
  });

  test("outside PRs ignore members, owners and bots", () => {
    expect(countOutsidePrs([
      { author_association: "MEMBER" }, { author_association: "COLLABORATOR" },
      { author_association: "CONTRIBUTOR", user: { type: "Bot" } }, { author_association: "FIRST_TIMER", user: { type: "User" } },
    ])).toBe(1);
  });
});
