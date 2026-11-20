import { describe, expect, test } from "bun:test";
import { validateConfig } from "@gitforage/core";
import { BACKTEST, renderSite } from "../src/index.ts";

const NOW = "2026-11-22T12:00:00.000Z";
const cfg = validateConfig({ topics: ["hl7"], profile: "Healthcare tools.", site: { repo: "acme/portal", title: "Acme portal" } });
const files = renderSite(cfg, [], { now: NOW });
const page = files.get("backtest.html")!;
const text = page.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the backtest page", () => {
  test("is built, labelled as simulated, and linked from the About page and every footer", () => {
    expect(page).toContain("<h1>Backtest (simulated)</h1>");
    expect(page).toContain("<title>Backtest (simulated) · Acme portal</title>");
    expect(files.get("about.html")).toContain('href="backtest.html"');
    for (const [p, body] of files) if (p.endsWith(".html")) expect(body).toMatch(/href="(\.\.\/)?backtest\.html">Backtest \(simulated\)</);
  });

  test("states the hit rate and the misses next to the lead time, and never claims more", () => {
    expect(text).toContain("54 days");
    expect(text).toContain("85 of the 1,025");
    expect(text).toContain("(8.3%)");
    expect(text).toContain("45 of 646 (7.0%)");
    expect(text).toContain("never trended");
    expect(text).toContain("ranks by fit to a reader's interests, not by virality");
    expect(text).toContain("tenfold");
    expect(text).toContain("Rank order still holds");
    expect(text).toContain("Nov 20, 2026");
    expect(text.toLowerCase()).not.toMatch(/finds projects before they trend|before they go viral|predicts? (what|the next)/);
    expect(page).not.toContain("—");
  });

  test("percentages are computed from the counts, not typed in", () => {
    for (const r of [...BACKTEST.runs, ...BACKTEST.velocity]) {
      expect(text).toContain(`${r.caught} of ${r.inScope.toLocaleString("en-US")} (${((r.caught / r.inScope) * 100).toFixed(1)}%)`);
    }
  });

  test("is static: same CSP, no scripts beyond the site's own, no outside links except GitHub repos", () => {
    expect(page).toContain(`content="default-src &#39;none&#39;; style-src &#39;self&#39;; font-src &#39;self&#39;; script-src &#39;self&#39;; img-src &#39;self&#39; data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`);
    expect(page.match(/<script\b[^>]*>/g)).toEqual(['<script src="assets/theme.js">', '<script src="assets/site.js" defer>']);
    for (const [, u] of page.matchAll(/href="(https?:[^"]*)"/g)) expect(u).toMatch(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?(#[a-z-]+)?$/);
    expect(page).toContain('href="https://github.com/floci-io/floci-az"');
  });
});
