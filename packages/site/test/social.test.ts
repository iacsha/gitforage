import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateConfig, type Digest, type DigestItem } from "@gitforage/core";
import { OG_IMAGE, renderSite, siteBinaries } from "../src/index.ts";

const NOW = "2026-11-22T12:00:00.000Z";
const item = (full: string, o: Partial<DigestItem> = {}): DigestItem => ({
  full_name: full, url: `https://github.com/${full}`, score: 10, stars: 120, language: "TypeScript", description: "A tool",
  sources: ["search"], reasons: [{ rule: "topic_match", points: 3, text: "your topic hl7" }], topics: ["hl7"], via_topics: [],
  created_at: "2026-10-01T00:00:00.000Z", pushed_at: "2026-11-20T00:00:00.000Z", lang: "en", health: null, ...o,
});
const digest = (items: DigestItem[]): Digest => ({ version: 1, date: "2026-11-22", mode: "discover", generated_at: "2026-11-22T06:00:00.000Z", items });
const cfg = (site: Record<string, unknown>) => validateConfig({ topics: ["hl7", "home-assistant"], profile: "Tools.", site: { repo: "acme/portal", ...site } });
const meta = (body: string, key: string) => {
  const m = new RegExp(`<meta (?:property|name)="${key.replace(/[.:]/g, "\\$&")}" content="([^"]*)">`).exec(body);
  return m ? m[1] : null;
};

describe("social cards", () => {
  const files = renderSite(cfg({ url: "https://gitforage.dev/", title: `Acme "portal" <b>` }), [digest([item("a/one")])], { now: NOW });
  const pages = [...files.entries()].filter(([p]) => p.endsWith(".html"));

  test("every page has og:title, og:description, an absolute og:image and og:url, and a large twitter card", () => {
    expect(pages.length).toBeGreaterThan(6);
    for (const [path, body] of pages) {
      const head = body.slice(0, body.indexOf("</head>"));
      expect(meta(head, "og:title")).toBeTruthy();
      expect(meta(head, "og:description")).toBeTruthy();
      expect(meta(head, "og:image")).toBe(`https://gitforage.dev/${OG_IMAGE}`);
      expect(meta(head, "og:url")).toBe(`https://gitforage.dev/${path}`);
      expect(meta(head, "og:image:width")).toBe("1200");
      expect(meta(head, "og:image:height")).toBe("630");
      expect(meta(head, "twitter:card")).toBe("summary_large_image");
    }
  });

  test("titles in the tags are escaped like everything else", () => {
    const head = files.get("about.html")!.split("</head>")[0];
    expect(meta(head, "og:title")).toBe("About · Acme &quot;portal&quot; &lt;b&gt;");
    expect(meta(head, "og:site_name")).toBe("Acme &quot;portal&quot; &lt;b&gt;");
    expect(head).not.toContain("<b>");
  });

  test("without site.url there is no og:image or og:url, and the twitter card is the small one", () => {
    const plain = renderSite(cfg({}), [digest([item("a/one")])], { now: NOW });
    for (const [p, body] of plain) {
      if (!p.endsWith(".html")) continue;
      expect(meta(body, "og:image")).toBeNull();
      expect(meta(body, "og:url")).toBeNull();
      expect(meta(body, "og:title")).toBeTruthy();
      expect(meta(body, "twitter:card")).toBe("summary");
    }
  });

  test("the card ships with the site and is a 1200x630 PNG", () => {
    const png = siteBinaries().get(`${OG_IMAGE}`)!;
    expect(png).toBeDefined();
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);
    expect(png.length).toBeLessThan(1_000_000);
    expect(readFileSync(join(import.meta.dir, "..", "..", "..", "scripts", "og-card.ts"), "utf8")).toContain("og-card.png");
  });

  test("the social tags add no script, style or outside link, and the CSP is unchanged", () => {
    for (const [, body] of pages) {
      expect(body.match(/<script\b[^>]*>/g)!.length).toBe(2);
      expect(body).not.toMatch(/<link[^>]+href="https?:/);
      expect(body).toContain("default-src &#39;none&#39;; style-src &#39;self&#39;; font-src &#39;self&#39;; script-src &#39;self&#39;; img-src &#39;self&#39; data:; base-uri &#39;none&#39;; form-action &#39;none&#39;");
    }
  });
});
