import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs, UsageError } from "../src/cli.ts";

const repo = (full: string, stars = 20) => ({
  full_name: full, owner: { login: full.split("/")[0] }, html_url: `https://github.com/${full}`,
  description: "a tool", stargazers_count: stars, language: "Go", topics: ["hl7"], license: { spdx_id: "MIT" },
  created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(), pushed_at: new Date().toISOString(),
  archived: false, fork: false, default_branch: "main",
});

/** Stand-in for api.github.com: two search hits, everything else empty. */
function fakeFetch(calls: string[]) {
  return (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    calls.push(u.pathname);
    if (u.hostname !== "api.github.com") throw new Error(`unexpected host ${u.hostname}`);
    const body = u.pathname === "/search/repositories" ? { items: [repo("a/one", 50), repo("b/two", 10)] }
      : u.pathname === "/search/issues" ? { items: [] }
      : u.pathname.endsWith("/community/profile") ? { files: {} }
      : [];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

describe("cli args", () => {
  test("parses flags", () => {
    expect(parseArgs(["preview", "--config", "x.yml", "--limit", "5", "--json"])).toMatchObject({
      cmd: "preview", config: "x.yml", limit: 5, json: true,
    });
    expect(parseArgs(["run", "--out", "d.md", "--no-cache"])).toMatchObject({ cmd: "run", out: "d.md", noCache: true });
  });

  test("rejects bad flags", () => {
    expect(() => parseArgs(["preview", "--limit", "0"])).toThrow(UsageError);
    expect(() => parseArgs(["preview", "--config"])).toThrow("--config needs a value");
    expect(() => parseArgs(["preview", "--bogus"])).toThrow("unknown option --bogus");
  });
});

describe("cli preview and run", () => {
  let dir: string, calls: string[], out: string[], err: string[];
  const realFetch = globalThis.fetch;
  let spies: { mockRestore(): void }[] = [];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gitforage-cli-"));
    writeFileSync(join(dir, "interests.yml"), "topics: [hl7]\nlimits:\n  signals_top: 1\n");
    calls = []; out = []; err = [];
    globalThis.fetch = fakeFetch(calls);
    spies = [
      spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); }),
      spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.join(" ")); }),
      spyOn(process.stdout, "write").mockImplementation(((s: string) => { out.push(String(s)); return true; }) as any),
    ];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const s of spies) s.mockRestore();
  });

  const cfgPath = () => join(dir, "interests.yml");
  const seenPath = () => join(dir, "state", "seen.json");

  test("config errors exit 2 with the problem list", async () => {
    writeFileSync(cfgPath(), "topcs: [hl7]\n");
    expect(await main(["preview", "--config", cfgPath()], {})).toBe(2);
    expect(err.join("\n")).toContain('topcs: unknown key (did you mean "topics"?)');
  });

  test("preview prints a ranked list and does not write seen state", async () => {
    expect(await main(["preview", "--config", cfgPath(), "--quiet"], { GITHUB_TOKEN: "t" })).toBe(0);
    const text = out.join("\n");
    expect(text.indexOf("a/one")).toBeLessThan(text.indexOf("b/two"));
    expect(text).toContain("https://github.com/a/one");
    expect(existsSync(seenPath())).toBe(false);
  });

  test("preview --json and --limit", async () => {
    await main(["preview", "--config", cfgPath(), "--quiet", "--json", "--limit", "1"], { GITHUB_TOKEN: "t" });
    const items = JSON.parse(out.join(""));
    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({ full_name: "a/one", sources: ["search"] });
    expect(items[0].reasons.length).toBeGreaterThan(0);
  });

  test("run writes seen state and reports only new items next time", async () => {
    const md = join(dir, "digest.md");
    expect(await main(["run", "--config", cfgPath(), "--quiet", "--out", md, "--limit", "1"], { GITHUB_TOKEN: "t" })).toBe(0);
    expect(readFileSync(md, "utf8")).toContain("[a/one]");
    expect(Object.keys(JSON.parse(readFileSync(seenPath(), "utf8")).seen)).toEqual(["a/one"]);

    await main(["run", "--config", cfgPath(), "--quiet", "--out", md], { GITHUB_TOKEN: "t" });
    const second = readFileSync(md, "utf8");
    expect(second).not.toContain("[a/one]");
    expect(second).toContain("[b/two]");
    expect(Object.keys(JSON.parse(readFileSync(seenPath(), "utf8")).seen)).toEqual(["a/one", "b/two"]);

    await main(["run", "--config", cfgPath(), "--quiet", "--out", md], { GITHUB_TOKEN: "t" });
    expect(readFileSync(md, "utf8")).toContain("Nothing new this time.");
  });

  test("run records star counts in stars.json beside the seen state; preview does not", async () => {
    await main(["preview", "--config", cfgPath(), "--quiet"], { GITHUB_TOKEN: "t" });
    expect(existsSync(join(dir, "state", "stars.json"))).toBe(false);
    await main(["run", "--config", cfgPath(), "--quiet", "--out", join(dir, "d.md")], { GITHUB_TOKEN: "t" });
    const stars = JSON.parse(readFileSync(join(dir, "state", "stars.json"), "utf8"));
    expect(stars.repos["a/one"].stars).toBe(50);
  });

  test("feedback.yml next to the config: a skipped repo is gone, bad entries are warnings", async () => {
    writeFileSync(join(dir, "feedback.yml"), [
      "version: 1", "marks:",
      "  - { repo: a/one, mark: skip, date: 2026-11-20, topics: [hl7], language: Go }",
      "  - { repo: ../../etc, mark: keep, date: 2026-11-20 }",
    ].join("\n"));
    await main(["preview", "--config", cfgPath(), "--json"], { GITHUB_TOKEN: "t" });
    const items = JSON.parse(out.join(""));
    expect(items.map((i: any) => i.full_name)).toEqual(["b/two"]);
    // b/two shares topic hl7, owner-free and language Go with the skipped repo, so it is nudged down.
    expect(items[0].reasons.find((r: any) => r.rule === "feedback").text).toBe("like repos you skipped (language Go, topic hl7)");
    expect(err.join("\n")).toContain("marks[1].repo: must be owner/repo");
  });

  test("--debug lists dropped repos with their reasons; the summary counts them", async () => {
    writeFileSync(cfgPath(), "topics: [hl7]\nfilters:\n  spoken_languages: [en]\nlimits:\n  signals_top: 0\n");
    const base = fakeFetch(calls);
    globalThis.fetch = (async (input: string | URL | Request) => {
      if (new URL(String(input)).pathname !== "/search/repositories") return base(input);
      const zh = { ...repo("c/zh", 30), description: "让你的命令行 Agent 在后台自己接活、自己跟进到底" };
      return new Response(JSON.stringify({ items: [repo("a/one", 50), zh] }), { status: 200 });
    }) as typeof fetch;
    await main(["preview", "--config", cfgPath(), "--json", "--debug"], { GITHUB_TOKEN: "t" });
    const items = JSON.parse(out.join(""));
    expect(items.map((i: any) => i.full_name)).toEqual(["a/one"]);
    expect(items[0]).toMatchObject({ lang: "und", star_farm: null });
    const log = err.join("\n");
    expect(log).toContain("dropped c/zh: written in Chinese (zh), not in filters.spoken_languages");
    expect(log).toContain("1 excluded (1 in other languages)");
  });

  test("run keeps a digest per date and mode; site builds the portal from them", async () => {
    await main(["run", "--config", cfgPath(), "--quiet", "--out", join(dir, "d.md")], { GITHUB_TOKEN: "t" });
    const digests = readdirSync(join(dir, "state", "digests"));
    expect(digests).toEqual([`${new Date().toISOString().slice(0, 10)}-discover.json`]);
    const d = JSON.parse(readFileSync(join(dir, "state", "digests", digests[0]), "utf8"));
    expect(d.items.map((i: any) => i.full_name)).toEqual(["a/one", "b/two"]);

    const site = join(dir, "site");
    expect(await main(["site", "--config", cfgPath(), "--quiet", "--out", site, "--repo", "acme/portal"], {})).toBe(0);
    const index = readFileSync(join(site, "index.html"), "utf8");
    expect(index).toContain('href="https://github.com/a/one"');
    expect(index).toContain("github.com/acme/portal/issues/new?template=gitforage-feedback.md&amp;title=keep%3A%20a%2Fone");
    expect(existsSync(join(site, "feed.xml"))).toBe(true);
    expect(existsSync(join(site, "assets", "site.js"))).toBe(true);
    expect(await main(["site", "--config", cfgPath(), "--quiet"], {})).toBe(2);
    expect(() => parseArgs(["site", "--repo", "a/b c"])).toThrow("--repo must look like owner/name");
  });

  test("feedback folds valid issues into feedback.yml and writes a reply per issue", async () => {
    await main(["run", "--config", cfgPath(), "--quiet", "--out", join(dir, "d.md")], { GITHUB_TOKEN: "t" });
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const issues = [
      { number: 11, title: "keep: a/one", state: "open", author_association: "NONE", user: { login: "visitor", type: "User", created_at: old } },
      { number: 12, title: "keep: <script>/x", state: "open", author_association: "NONE", user: { login: "visitor", type: "User", created_at: old } },
      { number: 13, title: "Docs typo", state: "open", author_association: "NONE", user: { login: "visitor", type: "User", created_at: old } },
    ];
    const event = { action: "opened", issue: { number: 14, title: "skip: b/two", state: "open", author_association: "OWNER", user: { login: "me", type: "User" } } };
    writeFileSync(join(dir, "issues.json"), JSON.stringify(issues));
    writeFileSync(join(dir, "event.json"), JSON.stringify(event));
    const replies = join(dir, "replies");
    expect(await main(["feedback", "--config", cfgPath(), "--quiet", "--issues", join(dir, "issues.json"), "--event", join(dir, "event.json"), "--replies", replies], { GITHUB_TOKEN: "t" })).toBe(0);
    const fb = readFileSync(join(dir, "feedback.yml"), "utf8");
    expect(fb).toContain("repo: a/one");
    expect(fb).toContain("from: visitor");
    expect(fb).toContain("repo: b/two");
    expect(fb).toContain("from: owner");
    expect(fb).not.toContain("script");
    expect(readdirSync(replies).sort()).toEqual(["11.md", "12.md", "14.md"]);
    expect(readFileSync(join(replies, "12.md"), "utf8")).toStartWith("Not recorded");
    expect(readFileSync(join(replies, "12.md"), "utf8")).not.toContain("<script>");

    // The input can also come from an environment variable; a broken input is a usage error.
    expect(await main(["feedback", "--config", cfgPath(), "--quiet"], { GITFORAGE_ISSUES_JSON: "[]" })).toBe(0);
    expect(await main(["feedback", "--config", cfgPath(), "--quiet"], { GITFORAGE_ISSUES_JSON: "{not json" })).toBe(2);
    expect(await main(["feedback", "--config", cfgPath(), "--quiet"], {})).toBe(2);
  });

  test("feedback refuses to rewrite a feedback.yml that has problems", async () => {
    writeFileSync(join(dir, "feedback.yml"), "version: 1\nmarks:\n  - { repo: ../x, mark: keep, date: 2026-11-20 }\n");
    expect(await main(["feedback", "--config", cfgPath(), "--quiet"], { GITFORAGE_ISSUES_JSON: "[]" })).toBe(1);
    expect(err.join("\n")).toContain("not changing");
  });

  test("the response cache makes a rerun free", async () => {
    await main(["preview", "--config", cfgPath(), "--quiet"], { GITHUB_TOKEN: "t" });
    const first = calls.length;
    await main(["preview", "--config", cfgPath(), "--quiet"], { GITHUB_TOKEN: "t" });
    expect(first).toBeGreaterThan(0);
    expect(calls.length).toBe(first);
  });
});
