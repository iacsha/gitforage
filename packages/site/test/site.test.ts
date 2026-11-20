import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDigest, validateConfig, withMode, type Digest, type DigestItem } from "@gitforage/core";
import {
  MAX_TOPIC_CHIPS, RULE_DESCRIPTIONS, atomFeed, chipTopics, csp, esc, feedbackUrl, href, html, momentum, numAttr, pagesUrl, renderSite, sortItems, stripUnsafe, trusted, writeSite, xmlEscape,
} from "../src/index.ts";

const NOW = "2026-11-22T12:00:00.000Z";

function item(full: string, o: Partial<DigestItem> = {}): DigestItem {
  return {
    full_name: full, url: `https://github.com/${full}`, score: 10, stars: 120, language: "TypeScript", description: "A tool",
    sources: ["search"], reasons: [{ rule: "topic_match", points: 3, text: "your topic hl7" }], topics: ["hl7"], via_topics: [],
    created_at: "2026-10-01T00:00:00.000Z", pushed_at: "2026-11-20T00:00:00.000Z", lang: "en", health: null, ...o,
  };
}

const digest = (mode: "discover" | "contribute", items: DigestItem[], date = "2026-11-22"): Digest =>
  ({ version: 1, date, mode, generated_at: `${date}T06:00:00.000Z`, items });

const config = (over: Record<string, unknown> = {}) =>
  validateConfig({ topics: ["hl7", "fhir"], profile: "Healthcare tools.", site: { repo: "acme/portal", title: "Acme portal" }, ...over });

/** The attribute names of every real tag. Text is escaped, so every "<" left starts a tag the renderer wrote. */
function attributeNames(body: string): string[] {
  const names: string[] = [];
  for (const [tag] of body.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const rest = tag.replace(/^<[a-zA-Z0-9]+/, "").replace(/\/?>$/, "");
    const attrs = rest.replace(/\s([a-zA-Z_:][a-zA-Z0-9_:.-]*)(="[^"]*")?/g, (_m, n) => { names.push(n.toLowerCase()); return ""; });
    if (attrs.trim()) throw new Error(`unparsed attribute text in ${tag}`);
  }
  return names;
}

/** A description written to break out of every context it might land in. */
const HOSTILE = [
  `<img src=x onerror="alert(1)">`,
  `<script>alert(2)</script>`,
  `javascript:alert(3)`,
  `" onmouseover="alert(4)" x="`,
  `' autofocus onfocus='alert(5)`,
  "`${alert(6)}`",
  "safe‮evil⁦hidden⁩​zero",
  "]]><!-- --><![CDATA[",
].join(" ");

describe("the HTML escaper", () => {
  test("escapes the five specials and the backtick", () => {
    expect(esc(`<a href="x" title='y'>&\`</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&#96;&lt;/a&gt;");
  });

  test("strips bidi overrides, isolates, zero-width and control characters, and lone surrogates", () => {
    expect(stripUnsafe("a‮b⁦c⁩d​e\u0000f\u001Bg﻿h")).toBe("abcdefgh");
    expect(stripUnsafe("x\uD800y")).toBe("x�y");
    expect(stripUnsafe("line\nbreak\ttab")).toBe("line break tab");
  });

  test("the html template escapes every value unless it is already safe markup", () => {
    const name = `<b onclick="x">`;
    expect(html`<p title="${name}">${name}</p>`.value).toBe(`<p title="&lt;b onclick=&quot;x&quot;&gt;">&lt;b onclick=&quot;x&quot;&gt;</p>`);
    expect(html`<ul>${["<a>", html`<li>${"<b>"}</li>`]}</ul>`.value).toBe("<ul>&lt;a&gt;<li>&lt;b&gt;</li></ul>");
    expect(html`${null}${undefined}${false}${trusted("<hr>")}`.value).toBe("<hr>");
  });

  test("href only lets through GitHub links and relative site links", () => {
    expect(href("https://github.com/a/b")).toBe("https://github.com/a/b");
    expect(href("../archive/2026-11-22-discover.html")).toBe("../archive/2026-11-22-discover.html");
    for (const bad of ["javascript:alert(1)", "JAVASCRIPT:x", "data:text/html,x", "//evil.example/x", "https://github.com.evil.example/a/b",
      "https://evil.example/", "https://github.com/a/b\"onclick=x", " https://github.com/a/b", "", "vbscript:x"]) {
      expect(() => href(bad)).toThrow("refusing to emit link");
    }
  });
});

describe("Keep and Skip links", () => {
  test("go to the portal repo's new-issue page with a strictly encoded title", () => {
    const u = feedbackUrl("acme/portal", "keep", "owner/name");
    expect(u).toBe("https://github.com/acme/portal/issues/new?template=gitforage-feedback.md&title=keep%3A%20owner%2Fname&labels=gitforage-feedback");
    const title = new URL(u).searchParams.get("title");
    expect(title).toBe("keep: owner/name");
    expect(title).toMatch(/^(keep|skip): [A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/);
    expect(feedbackUrl("acme/portal", "skip", "a.b/c_d-e")).toContain("title=skip%3A%20a.b%2Fc_d-e&");
  });

  test("refuse names that are not validated", () => {
    expect(() => feedbackUrl("acme/portal", "keep", "a/b&labels=x")).toThrow();
    expect(() => feedbackUrl("acme/portal", "keep", "../x")).toThrow();
    expect(() => feedbackUrl("acme/portal?x=1", "keep", "a/b")).toThrow();
  });

  test("the default Pages URL", () => {
    expect(pagesUrl("Acme/portal")).toBe("https://acme.github.io/portal/");
    expect(pagesUrl("acme/Acme.github.io")).toBe("https://acme.github.io/");
    expect(pagesUrl("../x")).toBeNull();
  });
});

describe("the portal", () => {
  const cfg = config();
  const digests = [
    digest("discover", [item("a/one", { sources: ["search", "kin"] }), item("b/two", { sources: ["fork"], description: "" })]),
    digest("contribute", [item("c/three", { sources: ["rising"], health: { outside_prs_90d: 6, issue_response: { answered: 8, total: 10 } } })]),
    digest("discover", [item("d/old", { topics: ["fhir"] })], "2026-11-15"),
  ];
  const files = renderSite(cfg, digests, { now: NOW });

  test("has every page, the feed and the assets", () => {
    expect([...files.keys()].sort()).toEqual([
      "about.html", "archive/2026-11-15-discover.html", "archive/2026-11-22-contribute.html", "archive/2026-11-22-discover.html",
      "archive/index.html", "assets/icon.svg", "assets/site.css", "assets/site.js", "assets/theme.js", "feed.xml", "index.html", "involved.html",
      "topics/fhir.html", "topics/hl7.html", "topics/index.html",
    ]);
  });

  test("Discover is the index; Get involved shows maintainer health", () => {
    const index = files.get("index.html")!;
    expect(index).toContain('<a href="index.html" aria-current="page">Discover</a>');
    expect(index).toContain('href="https://github.com/a/one"');
    expect(index).toContain(">New</span>");
    expect(index).toContain(">Like your stars</span>");
    expect(index).toContain(">Live fork</span>");
    expect(index).toContain("No description.");
    expect(index).toContain("<li>your topic hl7</li>");
    expect(index).toContain('<li class="meta-stars">120 stars</li>');
    expect(index).toContain('pushed <time datetime="2026-11-20T00:00:00.000Z">Nov 20, 2026</time>');
    expect(index).not.toContain("Maintainers");
    const involved = files.get("involved.html")!;
    expect(involved).toContain('<a href="involved.html" aria-current="page">Get involved</a>');
    expect(involved).toContain(">Rising</span>");
    expect(involved).toContain("merged 6 outside pull requests in 90 days · answered 8 of 10 recent issues");
  });

  test("Keep and Skip are labelled links to prefilled issues", () => {
    const index = files.get("index.html")!;
    expect(index).toContain(`href="https://github.com/acme/portal/issues/new?template=gitforage-feedback.md&amp;title=keep%3A%20a%2Fone&amp;labels=gitforage-feedback"`);
    expect(index).toContain('aria-label="Keep a/one: opens a prefilled GitHub issue"');
    expect(index).toContain('aria-label="Skip a/one: opens a prefilled GitHub issue"');
    const none = renderSite(validateConfig({ topics: ["hl7"] }), digests, { now: NOW }).get("index.html")!;
    expect(none).not.toContain("btn-keep");
    expect(renderSite(validateConfig({ topics: ["hl7"] }), digests, { now: NOW, repo: "x/y" }).get("index.html")).toContain("github.com/x/y/issues/new");
  });

  test("archive, topics and about pages", () => {
    expect(files.get("archive/index.html")).toContain('<a href="2026-11-15-discover.html">Discover</a>');
    expect(files.get("archive/2026-11-22-contribute.html")).toContain("merged 6 outside");
    expect(files.get("archive/2026-11-22-discover.html")).toContain('href="../assets/site.css"');
    const hl7 = files.get("topics/hl7.html")!;
    expect(hl7).toContain("a/one");
    expect(hl7).toContain("listed <time");
    expect(files.get("topics/fhir.html")).toContain("d/old");
    expect(files.get("topics/fhir.html")).not.toContain("a/one");
    const about = files.get("about.html")!;
    expect(about).toContain("Healthcare tools.");
    expect(about).toContain('href="https://github.com/acme/portal"');
    expect(about).toContain('href="https://github.com/iacsha/gitforage#run-your-own"');
    expect(about).toContain("<code>issue_response</code></th><td>off</td><td>3</td>");
  });

  test("every scoring rule is described on the About page", () => {
    expect(Object.keys(RULE_DESCRIPTIONS).sort()).toEqual(Object.keys(withMode(cfg, "discover").weights).sort());
  });

  test("footer: updated date, feed and run your own", () => {
    const index = files.get("index.html")!;
    expect(index).toContain('Updated <time datetime="2026-11-22T12:00:00.000Z">Nov 22, 2026</time>');
    expect(index).toContain(">Run your own gitforage</a>");
    expect(index).toContain('<link rel="alternate" type="application/atom+xml"');
  });

  test("empty states before the first run", () => {
    const empty = renderSite(cfg, [], { now: NOW });
    expect(empty.get("index.html")).toContain("No digest yet.");
    expect(empty.get("involved.html")).toContain("No digest yet.");
    expect(empty.get("archive/index.html")).toContain("No digests yet.");
  });

  test("writeSite writes under the output directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitforage-site-"));
    expect(writeSite(dir, files)).toBe(files.size);
    expect(readFileSync(join(dir, "topics", "hl7.html"), "utf8")).toBe(files.get("topics/hl7.html")!);
    expect(() => writeSite(dir, new Map([["../escape.html", "x"]]))).toThrow("bad output path");
    expect(() => writeSite(dir, new Map([["/etc/x", "x"]]))).toThrow("bad output path");
    expect(existsSync(join(dir, "..", "escape.html"))).toBe(false);
  });
});

describe("security of the rendered pages", () => {
  const cfg = config();
  const evil = item("evil/repo", {
    description: HOSTILE,
    language: `<svg onload=alert(7)>`,
    reasons: [{ rule: "topic_match", points: 3, text: `<img src=x onerror=alert(8)>` }],
  });
  const files = renderSite(cfg, [digest("discover", [evil]), digest("contribute", [evil])], { now: NOW });
  const pages = [...files.entries()].filter(([p]) => p.endsWith(".html"));

  test("a hostile description renders inert", () => {
    const index = files.get("index.html")!;
    expect(index).not.toContain("<img");
    // The header icons are the only SVG; none comes from repo text.
    expect(index.slice(index.indexOf("<main"))).not.toContain("<svg");
    expect(index).not.toContain("<script>alert");
    expect(attributeNames(index).filter((n) => n.startsWith("on") || n === "style" || n === "autofocus")).toEqual([]);
    expect(index).not.toContain('href="javascript:');
    expect(index).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(index).toContain("&quot; onmouseover=&quot;alert(4)&quot; x=&quot;");
    expect(index).toContain("&#39; autofocus onfocus=&#39;alert(5)");
    expect(index).toContain("&#96;${alert(6)}&#96;");
    expect(index).toContain("safeevilhiddenzero");
    expect(index).not.toMatch(/[‪-‮⁦-⁩​]/);
  });

  test("the only script tags are the same-origin theme.js (blocking, in head) and site.js (deferred)", () => {
    for (const [, body] of pages) {
      const up = body.includes('href="../assets') ? "../" : "";
      expect(body.match(/<script\b[^>]*>/g)).toEqual([`<script src="${up}assets/theme.js">`, `<script src="${up}assets/site.js" defer>`]);
      const head = body.slice(0, body.indexOf("</head>"));
      expect(head.indexOf("assets/theme.js")).toBeLessThan(head.indexOf("assets/site.css"));
    }
  });

  test("the CSP never allows inline script or style", () => {
    for (const [, body] of pages) {
      const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(body)![1];
      expect(policy).not.toContain("unsafe-inline");
      expect(policy).not.toContain("unsafe-eval");
      expect(policy).toContain("script-src &#39;self&#39;");
    }
  });

  test("no inline styles, inline event handlers or javascript: URLs anywhere", () => {
    for (const [, body] of pages) {
      expect(body).not.toMatch(/<style\b/i);
      expect(attributeNames(body).filter((n) => n.startsWith("on") || n === "style")).toEqual([]);
      expect(body).not.toMatch(/(href|src)="(?!https:\/\/github\.com\/|(?:\.\.\/)?[a-z0-9]|#)/);
    }
  });

  test("every page sends the strict CSP", () => {
    const want = "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'";
    expect(csp(cfg.site)).toBe(want);
    for (const [, body] of pages) expect(body).toContain(`<meta http-equiv="Content-Security-Policy" content="${want.replace(/'/g, "&#39;")}">`);
  });

  test("a hostile digest file on disk is cleaned when loaded", () => {
    const text = JSON.stringify({
      version: 1, generated_at: "2026-11-22T00:00:00Z",
      items: [
        { full_name: "javascript:alert(1)//x", score: 1, stars: 1 },
        { full_name: "ok/repo", url: "javascript:alert(1)", score: 1, stars: 1, description: "a‮b", sources: ["search", "evil"],
          reasons: [{ rule: "<x>", points: 1, text: "t" }, { rule: "license", points: 1, text: "<b>" }], topics: ["Bad Topic", "ok"] },
      ],
    });
    const { digest: d, problems } = parseDigest(text, "2026-11-22-discover.json");
    expect(problems).toEqual(["2026-11-22-discover.json items[0]: full_name must be owner/repo"]);
    expect(d!.items[0]).toMatchObject({ full_name: "ok/repo", url: "https://github.com/ok/repo", description: "ab", sources: ["search"], topics: ["ok"] });
    expect(d!.items[0].reasons).toEqual([{ rule: "license", points: 1, text: "<b>" }]);
    expect(renderSite(cfg, [d!], { now: NOW }).get("index.html")).toContain("<li>&lt;b&gt;</li>");
  });
});

describe("analytics", () => {
  test("off by default; GoatCounter adds its script with SRI and only its origins to the CSP", () => {
    const off = renderSite(config(), [], { now: NOW }).get("index.html")!;
    expect(off).not.toContain("goatcounter");
    const cfg = config({ site: { repo: "acme/portal", analytics: { provider: "goatcounter", code: "acme-portal" } } });
    expect(csp(cfg.site)).toBe(
      "default-src 'none'; style-src 'self'; script-src 'self' https://gc.zgo.at; img-src 'self' data: https://acme-portal.goatcounter.com; " +
      "connect-src https://acme-portal.goatcounter.com; base-uri 'none'; form-action 'none'",
    );
    const on = renderSite(cfg, [], { now: NOW }).get("index.html")!;
    expect(on).toContain('<script data-goatcounter="https://acme-portal.goatcounter.com/count" async src="https://gc.zgo.at/count.v4.js" integrity="sha384-');
    expect(on).toContain('crossorigin="anonymous"');
    expect(renderSite(cfg, [], { now: NOW }).get("about.html")).toContain("GoatCounter");
  });

  test("a hostile analytics code or provider is refused by the config", () => {
    for (const code of ["x.evil.example/", "a b", "<x>", "UPPER", "-lead"]) {
      expect(() => config({ site: { analytics: { provider: "goatcounter", code } } })).toThrow("site.analytics.code");
    }
    expect(() => config({ site: { analytics: { provider: "plausible", code: "x" } } })).toThrow("site.analytics.provider");
  });
});

describe("the Atom feed", () => {
  test("is Atom 1.0 with one entry per item and absolute ids", () => {
    const cfg = config();
    const feed = renderSite(cfg, [digest("discover", [item("a/one"), item("b/two")])], { now: NOW }).get("feed.xml")!;
    expect(feed.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">')).toBe(true);
    expect(feed.match(/<entry>/g)!.length).toBe(2);
    expect(feed).toContain("<id>https://acme.github.io/portal/feed.xml</id>");
    expect(feed).toContain('<link rel="self" type="application/atom+xml" href="https://acme.github.io/portal/feed.xml"/>');
    expect(feed).toContain("<id>https://acme.github.io/portal/archive/2026-11-22-discover.html#r-a-one</id>");
    expect(feed).toContain('<link rel="alternate" type="text/html" href="https://github.com/a/one"/>');
    expect(feed).toContain("<updated>2026-11-22T06:00:00.000Z</updated>");
  });

  test("escapes hostile text and drops characters XML does not allow", () => {
    expect(xmlEscape(`<a>&"'`)).toBe("&lt;a&gt;&amp;&quot;&apos;");
    const feed = atomFeed([digest("discover", [item("e/x", { description: `${HOSTILE}\u0001￾` })])], { title: `T<&>"`, baseUrl: null, updated: NOW });
    expect(feed).toContain("<title>T&lt;&amp;&gt;&quot;</title>");
    expect(feed).not.toContain("<img");
    expect(feed).not.toContain("<script");
    expect(feed).not.toContain("]]>");
    expect(feed).not.toMatch(/[\u0001￾‮]/);
    expect(feed).toContain("<id>urn:gitforage:2026-11-22:discover:e/x</id>");
    // Every tag in the output is one the feed writer emits.
    const tags = new Set([...feed.matchAll(/<\/?([a-zA-Z?][^\s/>]*)/g)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(["?xml", "author", "category", "entry", "feed", "generator", "id", "link", "name", "subtitle", "summary", "title", "updated"]);
  });
});

describe("theme and language controls", () => {
  const assets = join(import.meta.dir, "..", "assets");

  test("every page has the theme toggle and the language control, hidden until site.js runs", () => {
    const files = renderSite(config(), [digest("discover", [item("a/one")])], { now: NOW });
    for (const [path, body] of files) {
      if (!path.endsWith(".html")) continue;
      expect(body).toContain('<button type="button" class="pref-btn" data-theme-toggle aria-label="Theme: System. Switch to Light" hidden>');
      expect(body).toContain('<span data-theme-label>System</span>');
      expect(body).toMatch(/<button type="button" class="pref-btn" data-lang-toggle aria-pressed="(true|false)"[^>]* hidden>/);
      expect(body).toContain('aria-live="polite"');
    }
  });

  test("theme.js and site.js keep storage in try/catch and write no markup", () => {
    const theme = readFileSync(join(assets, "theme.js"), "utf8");
    const site = readFileSync(join(assets, "site.js"), "utf8");
    for (const js of [theme, site]) {
      expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/);
      const uses = js.split("window.localStorage").length - 1;
      const guarded = [...js.matchAll(/try \{[^}]*localStorage[^}]*\}/g)].reduce((n, m) => n + m[0].split("window.localStorage").length - 1, 0);
      expect(uses).toBeGreaterThan(0);
      expect(guarded).toBe(uses);
    }
    expect(theme).toContain('theme === "light" || theme === "dark"');
    expect(theme).toContain('lang === "only" || lang === "all"');
  });

  test("dark tokens are the same for the system setting and the manual choice; both themes meet WCAG AA", () => {
    const css = readFileSync(join(assets, "site.css"), "utf8");
    const tokens = (from: number) => Object.fromEntries([...css.slice(from, css.indexOf("}", from)).matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]));
    const light = tokens(css.indexOf(":root {"));
    const systemDark = tokens(css.indexOf(':root:not([data-theme="light"]) {'));
    const dark = tokens(css.indexOf(':root[data-theme="dark"] {'));
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    expect(systemDark).toEqual(dark);
    const lum = (h: string) => {
      const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const text = [["text", "bg"], ["text", "surface"], ["text", "chip-bg"], ["muted", "bg"], ["muted", "surface"], ["muted", "chip-bg"],
      ["accent", "surface"], ["accent", "bg"], ["on-accent", "accent"], ["new-fg", "new-bg"], ["rising-fg", "rising-bg"], ["fork-fg", "fork-bg"], ["kin-fg", "kin-bg"]];
    for (const t of [light, dark]) {
      for (const [f, b] of text) expect([f, b, ratio(t[f], t[b]) >= 4.5]).toEqual([f, b, true]);
      expect(ratio(t.focus, t.surface)).toBeGreaterThanOrEqual(3);
    }
    expect(css).toContain(':root:not([data-theme]) .pref-btn .icon-system');
    expect(css).toContain(':root[data-lang-default="only"]:not([data-lang-filter]) [data-lang-match="no"]');
  });

  test("cards carry an allow-listed data-lang, and the default choice comes from the config", () => {
    const items = [
      item("a/en", { lang: "en" }), item("a/zh", { lang: "zh" }), item("a/und", { lang: "und" }),
      item("a/evil", { lang: `"><script>alert(1)</script>` }), item("a/proto", { lang: "__proto__" }),
    ];
    const only = renderSite(config({ filters: { spoken_languages: ["en"] } }), [digest("discover", items)], { now: NOW }).get("index.html")!;
    expect(only).toContain('<html lang="en" data-lang-default="only" data-density=');
    expect(only).toContain('<li data-lang="en" data-lang-match="yes" ');
    expect(only).toContain('<li data-lang="zh" data-lang-match="no" ');
    expect(only).toContain('<li data-lang="und" data-lang-match="yes" ');
    expect(only.match(/data-lang="[^"]*"/g)!.sort()).toEqual(['data-lang="en"', 'data-lang="und"', 'data-lang="und"', 'data-lang="und"', 'data-lang="zh"']);
    expect(only).not.toContain("<script>alert");
    expect(only).toContain('aria-pressed="true"');
    expect(only).toContain("<span>English only</span>");

    const all = renderSite(config(), [digest("discover", items)], { now: NOW }).get("index.html")!;
    expect(all).toContain('<html lang="en" data-lang-default="all" data-density=');
    expect(all).toContain('aria-pressed="false"');
    expect(all).toContain('<li data-lang="zh" data-lang-match="no" ');

    const strict = renderSite(config({ filters: { spoken_languages: ["en", "de"], drop_undetected: true } }), [digest("discover", items)], { now: NOW }).get("index.html")!;
    expect(strict).toContain('<li data-lang="und" data-lang-match="no" ');
    expect(strict).toContain("<span>English and German only</span>");
  });

  test("a digest on disk with a bad lang is read as und", () => {
    const text = JSON.stringify({ version: 1, items: [{ full_name: "ok/repo", score: 1, stars: 1, lang: "<b>" }, { full_name: "ok/two", score: 1, stars: 1, lang: "ja" }] });
    const { digest: d } = parseDigest(text, "2026-11-22-discover.json");
    expect(d!.items.map((i) => i.lang)).toEqual(["und", "ja"]);
  });
});

describe("layout: density, fields, sort and filters", () => {
  const assets = join(import.meta.dir, "..", "assets");
  const items = [
    item("a/low", { score: 4, stars: 900, created_at: "2026-11-10T00:00:00.000Z", sources: ["search"], topics: ["hl7", "mllp"] }),
    item("a/high", { score: 20, stars: 30, created_at: "2026-06-01T00:00:00.000Z", sources: ["kin"], topics: ["fhir"],
      reasons: [{ rule: "star_velocity", points: 2.5, text: "~40 stars a month" }, { rule: "topic_match", points: 3, text: "your topic fhir" }] }),
    item("a/mid", { score: 9, stars: 300, created_at: "2025-01-01T00:00:00.000Z", sources: ["rising", "search"], topics: [], via_topics: ["hl7"],
      reasons: [{ rule: "star_growth", points: 4, text: "~90 stars a month lately" }] }),
  ];
  const build = (layout?: Record<string, unknown>, its = items) =>
    renderSite(config(layout ? { site: { repo: "acme/portal", title: "Acme portal", layout } } : {}), [digest("discover", its)], { now: NOW });
  const order = (body: string) => [...body.matchAll(/<article class="card" id="r-([a-z-]+)"/g)].map((m) => m[1]);

  /** data-* attributes the portal may emit. Anything else is a bug (or an injection). */
  const ALLOWED_DATA = new Set([
    "data-lang-default", "data-density", "data-sort-default", "data-fields-off", "data-lang", "data-lang-match", "data-sources", "data-topics",
    "data-score", "data-newest", "data-stars", "data-rising", "data-rank", "data-card", "data-cards", "data-theme-toggle", "data-theme-label",
    "data-lang-toggle", "data-pref-status", "data-density-group", "data-density-option", "data-view-bar", "data-sort-select", "data-field",
    "data-filter", "data-value", "data-filter-count", "data-filter-clear", "data-filter-empty", "data-goatcounter",
  ]);
  const NUMERIC = ["data-score", "data-newest", "data-stars", "data-rising", "data-rank"];
  const attrValues = (body: string, name: string) => [...body.matchAll(new RegExp(`\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]);

  test("defaults: comfortable, score order, every field on, written onto <html> so they hold without JavaScript", () => {
    const index = build().get("index.html")!;
    expect(index).toContain('data-density="comfortable" data-sort-default="score" data-fields-off="">');
    expect(order(index)).toEqual(["a-high", "a-mid", "a-low"]);
  });

  test("the config picks the default density, sort and hidden fields", () => {
    const index = build({ density: "list", sort: "stars", fields: { reasons: false, stars: false } }).get("index.html")!;
    expect(index).toContain('data-density="list" data-sort-default="stars" data-fields-off="reasons stars">');
    expect(order(index)).toEqual(["a-low", "a-mid", "a-high"]);
    expect(index).toContain('<option value="stars" selected>Stars</option>');
    expect(index).toContain('<input type="checkbox" data-field="reasons"> Reasons');
    expect(index).toContain('<input type="checkbox" data-field="language" checked> Language');
    expect(index).toContain('aria-checked="true" tabindex="0" aria-label="List"');
    expect(order(build({ sort: "newest" }).get("index.html")!)).toEqual(["a-low", "a-high", "a-mid"]);
    expect(order(build({ sort: "rising" }).get("index.html")!)).toEqual(["a-mid", "a-high", "a-low"]);
  });

  test("sortItems is stable and matches what site.js does (highest first, ties by build order)", () => {
    const tied = [item("t/a", { score: 5 }), item("t/b", { score: 7 }), item("t/c", { score: 5 }), item("t/d", { score: Number.NaN })];
    expect(sortItems(tied, "score").map((i) => i.full_name)).toEqual(["t/b", "t/a", "t/c", "t/d"]);
    expect(momentum(items[1])).toBe(2.5);
    const site = readFileSync(join(assets, "site.js"), "utf8");
    expect(site).toContain('return num(b, key) - num(a, key) || num(a, "rank") - num(b, "rank");');
  });

  test("the density control is a labelled radio group, hidden until site.js runs", () => {
    for (const [path, body] of build({ density: "compact" })) {
      if (!path.endsWith(".html")) continue;
      expect(body).toContain('<div class="density" role="radiogroup" aria-label="Density" data-density-group hidden>');
      const radios = [...body.matchAll(/<button type="button" class="density-opt" role="radio" aria-checked="(true|false)" tabindex="(0|-1)" aria-label="(\w+)"[^>]*data-density-option="(\w+)">/g)];
      expect(radios.map((m) => [m[1], m[2], m[3], m[4]])).toEqual([
        ["false", "-1", "Comfortable", "comfortable"], ["true", "0", "Compact", "compact"], ["false", "-1", "List", "list"],
      ]);
    }
  });

  test("the view bar has sort, the View menu, the count and filter chips with ARIA, hidden until site.js runs", () => {
    const index = build().get("index.html")!;
    expect(index).toContain('<div class="view-bar" data-view-bar hidden>');
    expect(index).toContain('<label class="view-sort"><span class="view-label">Sort</span> <select data-sort-select>');
    expect(attrValues(index, "value").filter((v) => ["score", "newest", "stars", "rising"].includes(v))).toEqual(["score", "newest", "stars", "rising"]);
    expect(index).toContain('<details class="view-menu">\n<summary>View</summary>\n<fieldset class="view-fields">\n<legend>Show on cards</legend>');
    // No maintainer line on Discover, so no switch for it.
    expect(index).not.toContain('data-field="health"');
    expect(index).toContain('<p class="view-count" data-filter-count aria-live="polite" aria-atomic="true"></p>');
    expect(index).toContain('<div class="filter-group" role="group" aria-label="Filter by source">');
    expect(index).toContain('<div class="filter-group" role="group" aria-label="Filter by topic">');
    const chips = [...index.matchAll(/<button type="button" class="filter-chip" data-filter="(\w+)" data-value="([a-z0-9-]+)" aria-pressed="false">([^<]+)<\/button>/g)].map((m) => m.slice(1).join(":"));
    expect(chips).toEqual(["source:search:New", "source:rising:Rising", "source:kin:Like your stars", "topic:hl7:hl7", "topic:fhir:fhir"]);
    expect(index).toContain('<button type="button" class="filter-clear" data-filter-clear hidden>Clear filters</button>');
    expect(index).toContain('<p class="empty" data-filter-empty hidden>');
    const involved = renderSite(config(), [digest("contribute", [item("c/h", { health: { outside_prs_90d: 2, issue_response: null } })])], { now: NOW }).get("involved.html")!;
    expect(involved).toContain('<input type="checkbox" data-field="health" checked> Maintainer line');
  });

  test("cards carry their sources and the chip topics they match; topics come from the config, else the commonest", () => {
    const index = build().get("index.html")!;
    expect(index).toContain('data-sources="search rising" data-topics="hl7"');
    expect(index).toContain('data-sources="search" data-topics="hl7"');
    expect(index).not.toContain("mllp");
    const bare = validateConfig({ seeds: ["a/b"] });
    const many = [item("x/1", { topics: ["cli", "rust"] }), item("x/2", { topics: ["cli"] }), item("x/3", { topics: ["rust", "cli", "solo"] })];
    expect(chipTopics(bare, many)).toEqual(["cli", "rust"]);
    const lots = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(chipTopics(validateConfig({ topics: lots }), [item("x/4", { topics: lots })])).toHaveLength(MAX_TOPIC_CHIPS);
    // Too many: the commonest on the page win, shown in config order.
    const fourteen = lots.slice(0, 14);
    const picked = chipTopics(validateConfig({ topics: fourteen }), [item("y/1", { topics: fourteen }), item("y/2", { topics: ["t13", "t12"] })]);
    expect(picked).toHaveLength(MAX_TOPIC_CHIPS);
    expect(picked.slice(-2)).toEqual(["t12", "t13"]);
    expect(picked).toEqual([...picked].sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))));
  });

  test("every data-* attribute is allow-listed, and the numeric ones are plain numbers", () => {
    const weird = [
      ...items,
      item("w/nan", { score: Number.NaN, stars: Number.POSITIVE_INFINITY, created_at: "not a date", reasons: [{ rule: "star_growth", points: Number.NaN, text: "x" }] }),
      item("w/huge", { score: 1e300, stars: -5, sources: ["evil" as any, "fork"], topics: [`"><b>`, "ok-topic", "__proto__"] }),
    ];
    for (const density of ["comfortable", "compact", "list"]) {
      for (const [path, body] of build({ density }, weird)) {
        if (!path.endsWith(".html")) continue;
        const names = attributeNames(body).filter((n) => n.startsWith("data-"));
        expect(names.filter((n) => !ALLOWED_DATA.has(n))).toEqual([]);
        for (const n of NUMERIC) for (const v of attrValues(body, n)) expect([n, v, /^-?\d+(\.\d+)?$/.test(v)]).toEqual([n, v, true]);
        for (const v of attrValues(body, "data-sources")) for (const t of v.split(" ").filter(Boolean)) expect(["search", "rising", "fork", "kin"]).toContain(t);
        for (const v of attrValues(body, "data-topics")) for (const t of v.split(" ").filter(Boolean)) expect(t).toMatch(/^[a-z0-9][a-z0-9-]{0,49}$/);
        for (const v of attrValues(body, "data-density")) expect(["comfortable", "compact", "list"]).toContain(v);
        for (const v of attrValues(body, "data-density-option")) expect(["comfortable", "compact", "list"]).toContain(v);
        for (const v of attrValues(body, "data-sort-default")) expect(["score", "newest", "stars", "rising"]).toContain(v);
        for (const v of attrValues(body, "data-fields-off")) for (const t of v.split(" ").filter(Boolean)) expect(["reasons", "health", "language", "stars"]).toContain(t);
        for (const v of attrValues(body, "data-field")) expect(["reasons", "health", "language", "stars"]).toContain(v);
        for (const v of attrValues(body, "data-filter")) expect(["source", "topic"]).toContain(v);
        for (const v of attrValues(body, "data-value")) expect(v).toMatch(/^[a-z0-9][a-z0-9-]{0,49}$/);
      }
    }
    expect(numAttr(Number.NaN)).toBe("0");
    expect(numAttr(1e300)).toBe("0");
    expect(numAttr(-2.456, 2)).toBe("-2.46");
    expect(numAttr("5" as any)).toBe("0");
  });

  test("a hostile description renders inert at every density, and the CSP never relaxes", () => {
    const evil = item("evil/repo", { description: HOSTILE, language: `<svg onload=alert(7)>`, topics: ["hl7"],
      reasons: [{ rule: "topic_match", points: 3, text: `<img src=x onerror=alert(8)>` }] });
    for (const density of ["comfortable", "compact", "list"]) {
      for (const sort of ["score", "newest", "stars", "rising"]) {
        const files = build({ density, sort, fields: { reasons: false } }, [evil, ...items]);
        for (const [path, body] of files) {
          if (!path.endsWith(".html")) continue;
          expect(body).not.toContain("<img");
          expect(body).not.toContain("<script>alert");
          expect(body.slice(body.indexOf("<main"))).not.toContain("<svg");
          expect(attributeNames(body).filter((n) => n.startsWith("on") || n === "style" || n === "autofocus")).toEqual([]);
          expect(body).not.toMatch(/[‪-‮⁦-⁩​]/);
          const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(body)![1];
          expect(policy).not.toContain("unsafe-inline");
          expect(policy).toContain("script-src &#39;self&#39;;");
          expect(body).not.toMatch(/<style\b/i);
        }
        expect(files.get("index.html")).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
      }
    }
  });

  test("theme.js accepts only known densities and field names from storage; site.js checks every value", () => {
    const theme = readFileSync(join(assets, "theme.js"), "utf8");
    expect(theme).toContain('density === "comfortable" || density === "compact" || density === "list"');
    expect(theme).toContain('var FIELDS = ["reasons", "health", "language", "stars"];');
    expect(theme).toContain("fields.length <= 64");
    const site = readFileSync(join(assets, "site.js"), "utf8");
    expect(site).toContain("SORTS.indexOf(savedSort) >= 0");
    expect(site).toContain('if ((kind !== "source" && kind !== "topic") || !value) return;');
    expect(site).not.toMatch(/querySelector(All)?\([^)]*\+\s*(value|kind|key|f)\b/);
  });

  test("the stylesheet has every density, the field switches and visible focus", () => {
    const css = readFileSync(join(assets, "site.css"), "utf8");
    for (const sel of [':root[data-density="compact"] .cards', ':root[data-density="list"] .card', ':root[data-fields-off~="reasons"] .chips',
      ':root[data-fields-off~="health"] .health', ':root[data-fields-off~="language"] .meta-lang', ':root[data-fields-off~="stars"] .meta-stars',
      "-webkit-line-clamp: 3", ".filter-chip[aria-pressed=\"true\"]", ".density-opt[aria-checked=\"true\"]", ":focus-visible { outline: 3px solid var(--focus)"]) {
      expect(css).toContain(sel);
    }
    // Columns never force a width wider than the screen (no horizontal scroll on a 360px phone).
    expect(css).toContain("minmax(min(100%, 15rem), 1fr)");
    expect(css).not.toMatch(/(?<!\()min-width:\s*(?:[2-9]\d|\d{3,})(?:\.\d+)?rem/);
  });

  for (const density of ["comfortable", "compact", "list"]) {
    test(`build output snapshot: ${density}`, () => {
      const index = build({ density }).get("index.html")!;
      expect(index.slice(index.indexOf("<main"), index.indexOf("</main>"))).toMatchSnapshot();
    });
  }
});
