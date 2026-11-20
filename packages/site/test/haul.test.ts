import { describe, expect, test } from "bun:test";
import { validateConfig, type Digest, type DigestItem } from "@gitforage/core";
import { haulIssues, issueId, parseHaulNotes, renderSite, siteContext, weekStart } from "../src/index.ts";

const NOW = "2026-11-22T12:00:00.000Z";
const item = (full: string, score: number, o: Partial<DigestItem> = {}): DigestItem => ({
  full_name: full, url: `https://github.com/${full}`, score, stars: 120, language: "TypeScript", description: "A tool",
  sources: ["search"], reasons: [{ rule: "topic_match", points: 3, text: "your topic hl7" }], topics: ["hl7"], via_topics: [],
  created_at: "2026-10-01T00:00:00.000Z", pushed_at: "2026-11-20T00:00:00.000Z", lang: "en", health: null, ...o,
});
const digest = (date: string, items: DigestItem[], mode: "discover" | "contribute" = "discover"): Digest =>
  ({ version: 1, date, mode, generated_at: `${date}T06:00:00.000Z`, items });
const cfg = (site: Record<string, unknown> = {}) =>
  validateConfig({ topics: ["hl7"], profile: "Tools.", filters: { spoken_languages: ["en"] }, site: { repo: "acme/portal", title: "Acme", ...site } });
const ctx = siteContext(cfg(), { now: NOW });

// Newest first, as loadDigests returns them.
const DIGESTS = [
  digest("2026-11-22", [item("e/five", 9), item("a/one", 50), item("f/six", 8), item("g/seven", 7)]),
  digest("2026-11-22", [item("x/helper", 99)], "contribute"),
  digest("2026-11-18", [item("d/four", 6)]),
  digest("2026-11-15", [item("a/one", 20), item("b/two", 30), item("c/three", 10), item("d/four", 5), item("z/foreign", 90, { lang: "de" })]),
  digest("2026-11-01", []),
];

describe("The Haul", () => {
  test("weeks run Monday to Sunday in UTC", () => {
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
    expect(() => weekStart("2026-13-40")).toThrow();
    expect(issueId(7)).toBe("007");
    expect(issueId(1234)).toBe("1234");
    expect(() => issueId(0)).toThrow();
  });

  test("three best new finds a week, deduped against earlier issues, discover only, in the portal's languages", () => {
    const issues = haulIssues(ctx, DIGESTS);
    expect(issues.map((i) => [i.number, i.week, i.picks.map((p) => p.full_name)])).toEqual([
      [1, "2026-11-09", ["b/two", "a/one", "c/three"]],
      [2, "2026-11-16", ["e/five", "f/six", "g/seven"]],
    ]);
    // Two digests in one week make one issue; its date is the week's last digest.
    expect(issues[1].published).toBe("2026-11-22T06:00:00.000Z");
  });

  test("numbering is stable: the same state gives the same issues, and a new week only adds one", () => {
    const a = haulIssues(ctx, DIGESTS), b = haulIssues(ctx, [...DIGESTS].reverse());
    expect(b).toEqual(a);
    const later = haulIssues(ctx, [digest("2026-11-29", [item("h/eight", 40), item("a/one", 60)]), ...DIGESTS]);
    expect(later.slice(0, 2)).toEqual(a);
    expect(later[2].number).toBe(3);
    expect(later[2].picks.map((p) => p.full_name)).toEqual(["h/eight"]);
    const files = renderSite(cfg(), DIGESTS, { now: NOW });
    const again = renderSite(cfg(), DIGESTS, { now: NOW });
    for (const p of ["haul/index.html", "haul/001.html", "haul/002.html", "haul/feed.xml"]) expect(files.get(p)).toBe(again.get(p)!);
    expect(files.has("haul/003.html")).toBe(false);
  });

  test("notes: NNN: text lines, comments and blanks skipped, bad lines reported, text cleaned and capped", () => {
    const { notes, problems } = parseHaulNotes("# comment\n\n1: First walk.\nnonsense\n002:  A ‮quiet​ week\n0: zero\n3:\n" + `4: ${"x".repeat(400)}`);
    expect(notes.get(1)).toBe("First walk.");
    expect(notes.get(2)).toBe("A quiet week");
    expect(notes.has(3)).toBe(false);
    expect(notes.get(4)!.length).toBe(280);
    expect(problems).toHaveLength(2);
    expect(parseHaulNotes("x".repeat(70_000)).notes.size).toBe(0);
  });

  test("an issue shows its note when there is one and leaves the paragraph out when there is not", () => {
    const files = renderSite(cfg(), DIGESTS, { now: NOW, haulNotes: new Map([[1, `Mind the <script>alert(1)</script> & "quotes"`]]) });
    const one = files.get("haul/001.html")!, two = files.get("haul/002.html")!;
    expect(one).toContain('<p class="lede haul-note">Mind the &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;</p>');
    expect(two).not.toContain("haul-note");
    expect(one).toContain("<h1>The Haul, No. 001</h1>");
    expect(one).toContain('href="002.html" rel="next"');
    expect(two).toContain('href="001.html" rel="prev"');
    expect(files.get("haul/index.html")).toContain('href="001.html">No. 001</a>');
    expect(files.get("archive/index.html")).toContain('href="../haul/index.html"');
  });

  test("hostile repo names and descriptions render inert on the pages and in the feed", () => {
    const evil = item("evil/repo", 100, { description: `<img src=x onerror="alert(1)"> ]]><![CDATA[ ‮evil`, language: "<svg onload=alert(2)>" });
    const files = renderSite(cfg({ url: "https://gitforage.dev/" }), [digest("2026-11-22", [evil, item("bad/<script>", 200)])], { now: NOW });
    const page = files.get("haul/001.html")!;
    expect(page).not.toContain("<img");
    expect(page).not.toContain("<script>");
    expect(page).not.toContain("<svg onload");
    expect(page).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(page).not.toMatch(/[‪-‮]/);
    expect(page).not.toContain("bad/");
    const feed = files.get("haul/feed.xml")!;
    expect(feed).not.toContain("<img");
    expect(feed).toContain("&amp;lt;img src=x onerror=&amp;quot;alert(1)&amp;quot;&amp;gt;");
    expect(feed).not.toContain("<![CDATA[");
    expect(feed).not.toContain("bad/");
  });

  test("every Haul page carries the strict CSP and absolute social tags", () => {
    const files = renderSite(cfg({ url: "https://gitforage.dev/" }), DIGESTS, { now: NOW });
    for (const p of ["haul/index.html", "haul/001.html", "haul/002.html"]) {
      const body = files.get(p)!;
      expect(body).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;self&#39;; font-src &#39;self&#39;; script-src &#39;self&#39;; img-src &#39;self&#39; data:; base-uri &#39;none&#39;; form-action &#39;none&#39;">`);
      expect(body).toContain(`<meta property="og:url" content="https://gitforage.dev/${p}">`);
      expect(body).toContain('<meta property="og:image" content="https://gitforage.dev/assets/og-card.png">');
      expect(body.match(/<script\b[^>]*>/g)).toEqual(['<script src="../assets/theme.js">', '<script src="../assets/site.js" defer>']);
    }
  });

  test("the Haul feed is Atom with one entry per issue, newest first, absolute ids with a url and urns without", () => {
    const feed = renderSite(cfg({ url: "https://gitforage.dev/" }), DIGESTS, { now: NOW }).get("haul/feed.xml")!;
    expect(feed.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
    expect([...feed.matchAll(/<id>([^<]*)<\/id>/g)].map((m) => m[1])).toEqual([
      "https://gitforage.dev/haul/feed.xml", "https://gitforage.dev/haul/002.html", "https://gitforage.dev/haul/001.html",
    ]);
    expect(feed).toContain('<link rel="self" type="application/atom+xml" href="https://gitforage.dev/haul/feed.xml"/>');
    expect(feed).toContain("&lt;a href=&quot;https://github.com/b/two&quot;&gt;b/two&lt;/a&gt;");
    const bare = renderSite(cfg({ repo: null }), DIGESTS, { now: NOW }).get("haul/feed.xml")!;
    expect(bare).toContain("<id>urn:gitforage:haul:001</id>");
    const empty = renderSite(cfg(), [], { now: NOW });
    expect(empty.get("haul/index.html")).toContain("No issues yet.");
    expect(empty.get("haul/feed.xml")).not.toContain("<entry>");
  });
});
