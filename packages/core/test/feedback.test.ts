import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFeedback, feedbackOf, loadFeedback, nudgesFrom, parseFeedback, scoreCandidate, type Mark } from "../src/index.ts";
import { NOW, cand, cfg, repo } from "./helpers.ts";

const m = (repo: string, mark: "keep" | "skip", topics: string[] = [], language: string | null = null, date = "2026-11-20"): Mark =>
  ({ repo, mark, date, topics, language });

describe("feedback.yml parsing", () => {
  test("valid marks parse; every bad entry is reported and dropped", () => {
    const f = parseFeedback([
      "version: 1", "marks:",
      "  - { repo: a/b, mark: keep, date: 2026-11-20, topics: [hl7, fhir], language: Java }",
      "  - { repo: '<script>/x', mark: keep, date: 2026-11-20 }",
      "  - { repo: a/c, mark: love, date: 2026-11-20 }",
      "  - { repo: a/d, mark: skip, date: yesterday }",
      "  - { repo: a/e, mark: skip, date: 2026-11-20, topics: ['Not A Topic'] }",
      "  - { repo: a/f, mark: skip, date: 2026-11-20, run: 'rm -rf /' }",
      "  - just text",
    ].join("\n"));
    expect(f.marks).toEqual([m("a/b", "keep", ["hl7", "fhir"], "Java")]);
    expect(f.problems.map((p) => p.replace(/^feedback\.yml /, ""))).toEqual([
      "marks[1].repo: must be owner/repo", "marks[2].mark: must be keep or skip", "marks[3].date: must be YYYY-MM-DD",
      "marks[4].topics: must be a list of up to 30 GitHub topics", "marks[5]: unknown key run", "marks[6]: must be a mapping",
    ]);
  });

  test("hostile YAML is refused, not expanded or executed", () => {
    expect(parseFeedback("version: 1\nmarks: !!js/function 'x'\n").problems[0]).toContain("not valid YAML");
    expect(parseFeedback("a: &a [1]\nb: *a\n").problems[0]).toContain("not valid YAML"); // no aliases at all
    expect(parseFeedback("x".repeat(1024 * 1024 + 1)).problems[0]).toContain("larger than 1 MB");
    expect(parseFeedback("version: 2\nmarks: []\n").problems[0]).toContain("expected version: 1");
    expect(parseFeedback("")).toEqual({ marks: [], problems: [] });
  });

  test("append validates, writes atomically and round-trips; a broken file is not overwritten", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-fb-"));
    const p = join(dir, "feedback.yml");
    expect(loadFeedback(p)).toEqual({ marks: [], problems: [] });
    expect(appendFeedback(p, [m("a/b", "keep", ["hl7"], "Go"), { ...m("../x", "keep") }])).toBe(1);
    expect(appendFeedback(p, [m("c/d", "skip")])).toBe(1);
    expect(loadFeedback(p).marks.map((x) => x.repo)).toEqual(["a/b", "c/d"]);
    expect(readFileSync(p, "utf8")).toStartWith("# gitforage feedback");
    writeFileSync(p, "version: 1\nmarks:\n  - { repo: x, mark: keep, date: 2026-11-20 }\n");
    expect(() => appendFeedback(p, [m("a/b", "keep")])).toThrow("not changing");
  });
});

describe("feedback nudges", () => {
  test("net marks per topic, owner and language, squashed into -1..1; the latest mark per repo wins", () => {
    const n = nudgesFrom([
      m("a/one", "keep", ["hl7", "fhir"], "Java"), m("a/two", "keep", ["hl7"], "Java"), m("b/tv", "skip", ["spamlist"], "Kotlin"),
      m("c/x", "keep", ["hl7"], null, "2026-11-01"), m("c/x", "skip", ["hl7"], null, "2026-11-10"),
    ]);
    expect(n.topics.get("hl7")).toBeCloseTo(Math.tanh(0.5), 3); // +1 +1 -1
    expect(n.topics.get("spamlist")).toBeCloseTo(-Math.tanh(0.5), 3);
    expect(n.owners.get("a")).toBeCloseTo(Math.tanh(1), 3);
    expect(n.languages.get("java")).toBeCloseTo(Math.tanh(1), 3);
    expect(n.repos.get("c/x")).toBe("skip");
  });

  test("the feedback rule moves scores up and down, with reasons", () => {
    const n = nudgesFrom([m("a/one", "keep", ["hl7"], "Java"), m("a/two", "keep", ["hl7"], "Java"), m("z/tv", "skip", ["spamlist"])]);
    const liked = cand("a/three", {}, { topics: ["hl7", "other"], language: "Java" });
    liked.feedback = feedbackOf(liked.repo, n)!;
    const r = scoreCandidate(liked, cfg(), NOW).reasons.find((x) => x.rule === "feedback")!;
    expect(r.points).toBeCloseTo(2 * Math.tanh(1) + Math.tanh(1) + Math.tanh(1), 1);
    expect(r.text).toBe("like repos you kept (owner a, topic hl7)");
    const disliked = cand("q/r", {}, { topics: ["spamlist"], language: "Rust" });
    disliked.feedback = feedbackOf(disliked.repo, n)!;
    const d = scoreCandidate(disliked, cfg(), NOW).reasons.find((x) => x.rule === "feedback")!;
    expect(d.points).toBeLessThan(0);
    expect(d.text).toBe("like repos you skipped (topic spamlist)");
    expect(feedbackOf(repo("n/o", { topics: ["x"], language: "C" }), n)).toBeNull();
    expect(scoreCandidate(liked, cfg({ weights: { feedback: 0 } }), NOW).reasons.some((x) => x.rule === "feedback")).toBe(false);
  });
});
