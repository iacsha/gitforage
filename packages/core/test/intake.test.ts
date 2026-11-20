import { describe, expect, test } from "bun:test";
import {
  DEFAULT_FEEDBACK, REASONS, intake, issuesFrom, nudgesFrom, parseFeedback, parseFeedbackTitle, replyFor,
  type Digest, type IntakeOptions, type Mark,
} from "../src/index.ts";
import { NOW, daysAgo } from "./helpers.ts";

const digest: Digest = {
  version: 1, date: "2026-11-15", mode: "discover", generated_at: "2026-11-15T06:00:00.000Z",
  items: [
    { full_name: "Acme/Engine", url: "https://github.com/Acme/Engine", score: 9, stars: 50, language: "Java", description: "",
      sources: ["search"], reasons: [], topics: ["hl7", "fhir"], via_topics: [], created_at: "", pushed_at: "", lang: "und", health: null },
    { full_name: "b/two", url: "https://github.com/b/two", score: 5, stars: 9, language: null, description: "",
      sources: ["kin"], reasons: [], topics: [], via_topics: [], created_at: "", pushed_at: "", lang: "und", health: null },
  ],
};

let n = 0;
const issue = (title: string, o: Record<string, unknown> = {}, user: Record<string, unknown> = {}) => ({
  number: ++n, title, state: "open", author_association: "NONE",
  user: { login: "visitor1", type: "User", created_at: daysAgo(400), ...user }, labels: [], ...o,
});

function opts(o: Partial<IntakeOptions> = {}): IntakeOptions & { lookups: string[] } {
  const lookups: string[] = [];
  return {
    feedback: { ...DEFAULT_FEEDBACK },
    now: NOW,
    existing: [],
    digests: [digest],
    accountCreatedAt: async (login) => { lookups.push(`user:${login}`); return daysAgo(400); },
    repoFacts: async (full) => { lookups.push(`repo:${full}`); return full === "x/elsewhere" ? { full_name: "x/elsewhere", topics: ["cli"], language: "Go" } : null; },
    lookups,
    ...o,
  };
}

const reasons = (out: Awaited<ReturnType<typeof intake>>) => out.map((o) => (o.status === "accepted" ? `ok ${o.mark.mark} ${o.mark.repo}` : o.reason));

describe("feedback titles", () => {
  test("only the exact form parses", () => {
    expect(parseFeedbackTitle("keep: acme/engine")).toEqual({ mark: "keep", repo: "acme/engine" });
    expect(parseFeedbackTitle("skip: a.b/c_d-e")).toEqual({ mark: "skip", repo: "a.b/c_d-e" });
    for (const bad of [
      "Keep: acme/engine", "keep:acme/engine", "keep:  acme/engine", " keep: acme/engine", "keep: acme/engine ", "keep: acme/engine\n",
      "keep: acme/engine/x", "keep: ../etc", "keep: ./x", "keep: a/..", "keep: acme/engine; rm -rf /", "keep: $(id)/x", "keep: a/`id`",
      "love: acme/engine", "keep: " + "a".repeat(40) + "/x", "keep: a/" + "b".repeat(101), "keep: acme/engine‮", "keep: аcme/engine",
    ]) {
      expect(parseFeedbackTitle(bad)).toBeNull();
    }
    expect(parseFeedbackTitle(42)).toBeNull();
    expect(parseFeedbackTitle(null)).toBeNull();
  });
});

describe("intake input", () => {
  test("accepts an issues event, a REST list or { issues }, drops PRs, closed and malformed entries", () => {
    const list = issuesFrom(
      { action: "opened", issue: { number: 7, title: "keep: a/b", state: "open", user: { login: "u" } } },
      [{ number: 3, title: "skip: a/b", user: { login: "u" } }, { number: 4, pull_request: {}, title: "keep: a/b" }, { number: 5, state: "closed", title: "keep: a/b" }],
      { issues: [{ number: 7, title: "dup" }, { number: -1, title: "x" }, { number: 1.5 }, "junk", null] },
    );
    expect(list.map((i) => i.number)).toEqual([3, 7]);
    expect(list[1].title).toBe("keep: a/b");
  });
});

describe("intake rules", () => {
  test("a visitor's valid mark on a listed repo is accepted with the digest's topics and language", async () => {
    const out = await intake(issuesFrom([issue("keep: acme/engine")]), opts());
    expect(out[0]).toMatchObject({
      status: "accepted",
      mark: { repo: "Acme/Engine", mark: "keep", date: "2026-11-20", topics: ["hl7", "fhir"], language: "Java", from: "visitor", by: "visitor1" },
    });
  });

  test("malformed titles are rejected and never echoed back", async () => {
    const hostile = "keep: <img src=x onerror=alert(1)>/x";
    const out = await intake(issuesFrom([issue(hostile), issue("Keep: acme/engine")]), opts());
    expect(reasons(out)).toEqual([REASONS.title, REASONS.title]);
    const reply = replyFor(out[0]);
    expect(reply).not.toContain("<img");
    expect(reply).not.toContain("onerror");
    expect(reply).toContain("Not recorded");
  });

  test("issues that are not feedback are left alone", async () => {
    const out = await intake(issuesFrom([issue("Bug: the page is blank"), issue("hello", { labels: [{ name: "gitforage-feedback" }] })]), opts());
    expect(out.map((o) => o.number)).toEqual([n]);
    expect(reasons(out)).toEqual([REASONS.title]);
  });

  test("bots are ignored", async () => {
    const out = await intake(issuesFrom([issue("keep: acme/engine", {}, { type: "Bot", login: "helper" }), issue("keep: acme/engine", {}, { login: "dependabot[bot]" })]), opts());
    expect(reasons(out)).toEqual([REASONS.bot, REASONS.user]);
  });

  test("young accounts are ignored; age is read from the input or looked up", async () => {
    const o = opts();
    const out = await intake(issuesFrom([
      issue("keep: acme/engine", {}, { login: "newbie", created_at: daysAgo(3) }),
      issue("keep: acme/engine", {}, { login: "lookedup", created_at: undefined }),
    ]), o);
    expect(reasons(out)).toEqual([REASONS.young(30), "ok keep Acme/Engine"]);
    expect(o.lookups).toEqual(["user:lookedup"]);
    const unknown = await intake(issuesFrom([issue("keep: acme/engine", {}, { login: "ghost", created_at: undefined })]), opts({ accountCreatedAt: async () => null }));
    expect(reasons(unknown)).toEqual([REASONS.ageUnknown]);
    const failing = await intake(issuesFrom([issue("keep: acme/engine", {}, { login: "ghost", created_at: undefined })]), opts({ accountCreatedAt: async () => { throw new Error("down"); } }));
    expect(reasons(failing)).toEqual([REASONS.ageUnknown]);
  });

  test("per-user limit per run, counting marks the same user made earlier today", async () => {
    const o = opts({ feedback: { ...DEFAULT_FEEDBACK, max_per_user: 2 } });
    const out = await intake(issuesFrom([issue("keep: acme/engine"), issue("keep: b/two"), issue("skip: b/two"), issue("keep: b/two", {}, { login: "other" })]), o);
    expect(reasons(out)).toEqual(["ok keep Acme/Engine", "ok keep b/two", REASONS.limit(2), "ok keep b/two"]);
    const earlier: Mark[] = [{ repo: "b/two", mark: "keep", date: "2026-11-20", topics: [], language: null, from: "visitor", by: "Visitor1" }];
    const again = await intake(issuesFrom([issue("keep: acme/engine")]), opts({ existing: earlier, feedback: { ...DEFAULT_FEEDBACK, max_per_user: 1 } }));
    expect(reasons(again)).toEqual([REASONS.limit(1)]);
    const yesterday: Mark[] = [{ ...earlier[0], date: "2026-11-19" }];
    expect(reasons(await intake(issuesFrom([issue("keep: acme/engine")]), opts({ existing: yesterday, feedback: { ...DEFAULT_FEEDBACK, max_per_user: 1 } })))).toEqual(["ok keep Acme/Engine"]);
  });

  test("visitors can only mark listed repos, with no API call; owners can mark any repo", async () => {
    const o = opts();
    const out = await intake(issuesFrom([
      issue("keep: x/elsewhere"),
      issue("keep: x/elsewhere", { author_association: "OWNER" }, { login: "me" }),
      issue("skip: x/missing", { author_association: "COLLABORATOR" }, { login: "me" }),
    ]), o);
    expect(reasons(out)).toEqual([REASONS.notListed, "ok keep x/elsewhere", REASONS.notFound]);
    expect(out[1]).toMatchObject({ mark: { from: "owner", by: "me", topics: ["cli"], language: "Go" } });
    expect(o.lookups).toEqual(["repo:x/elsewhere", "repo:x/missing"]);
  });

  test("owners skip the account-age check and the per-user limit", async () => {
    const o = opts({ feedback: { ...DEFAULT_FEEDBACK, max_per_user: 1 } });
    const out = await intake(issuesFrom([
      issue("keep: acme/engine", { author_association: "MEMBER" }, { login: "me", created_at: daysAgo(1) }),
      issue("keep: b/two", { author_association: "MEMBER" }, { login: "me", created_at: daysAgo(1) }),
    ]), o);
    expect(reasons(out)).toEqual(["ok keep Acme/Engine", "ok keep b/two"]);
    expect(o.lookups).toEqual([]);
  });

  test("visitors can be turned off", async () => {
    const out = await intake(issuesFrom([issue("keep: acme/engine"), issue("keep: acme/engine", { author_association: "OWNER" }, { login: "me" })]),
      opts({ feedback: { ...DEFAULT_FEEDBACK, visitors: false } }));
    expect(reasons(out)).toEqual([REASONS.visitors, "ok keep Acme/Engine"]);
  });

  test("a repeat of the same mark is not recorded twice; a change of mind is", async () => {
    const out = await intake(issuesFrom([issue("keep: acme/engine"), issue("keep: acme/engine"), issue("skip: acme/engine")]), opts());
    expect(reasons(out)).toEqual(["ok keep Acme/Engine", REASONS.duplicate, "ok skip Acme/Engine"]);
  });

  test("replies are built from fixed text and validated names", async () => {
    const out = await intake(issuesFrom([issue("keep: acme/engine")]), opts());
    expect(replyFor(out[0])).toBe("Recorded **keep** for [Acme/Engine](https://github.com/Acme/Engine) as a visitor mark. Thanks! It counts from the next run. This issue closes automatically.\n");
  });
});

describe("owner and visitor marks in the score", () => {
  const mk = (repo: string, mark: "keep" | "skip", o: Partial<Mark> = {}): Mark => ({ repo, mark, date: "2026-11-20", topics: ["hl7"], language: null, ...o });

  test("a visitor mark counts a quarter of an owner mark by default", () => {
    const owner = nudgesFrom([mk("a/b", "keep")]).topics.get("hl7")!;
    const visitor = nudgesFrom([mk("a/b", "keep", { from: "visitor", by: "v" })]).topics.get("hl7")!;
    expect(owner).toBeCloseTo(Math.tanh(0.5), 3);
    expect(visitor).toBeCloseTo(Math.tanh(0.125), 3);
    expect(nudgesFrom([mk("a/b", "keep", { from: "visitor", by: "v" })], 0).topics.size).toBe(0);
  });

  test("only an owner's skip hides a repo; visitors cannot outvote it", () => {
    const n = nudgesFrom([
      mk("a/b", "skip"),
      mk("a/b", "keep", { from: "visitor", by: "v1", date: "2026-11-21" }),
      mk("c/d", "skip", { from: "visitor", by: "v2" }),
    ]);
    expect(n.repos.get("a/b")).toBe("skip");
    expect(n.repos.has("c/d")).toBe(false);
  });

  test("each visitor counts once per repo (their latest mark)", () => {
    const n = nudgesFrom([
      mk("a/b", "keep", { from: "visitor", by: "v1" }),
      mk("a/b", "keep", { from: "visitor", by: "V1", date: "2026-11-21" }),
      mk("a/b", "keep", { from: "visitor", by: "v2" }),
    ]);
    expect(n.topics.get("hl7")).toBeCloseTo(Math.tanh(0.25), 3);
  });

  test("feedback.yml round-trips from and by, and validates them", () => {
    const f = parseFeedback([
      "version: 1", "marks:",
      "  - { repo: a/b, mark: keep, date: 2026-11-20, from: visitor, by: someone }",
      "  - { repo: a/c, mark: keep, date: 2026-11-20, from: admin }",
      "  - { repo: a/d, mark: keep, date: 2026-11-20, by: 'bad login!' }",
    ].join("\n"));
    expect(f.marks).toEqual([{ repo: "a/b", mark: "keep", date: "2026-11-20", topics: [], language: null, from: "visitor", by: "someone" }]);
    expect(f.problems.map((p) => p.replace(/^feedback\.yml /, ""))).toEqual(["marks[1].from: must be owner or visitor", "marks[2].by: must be a GitHub login"]);
  });
});
