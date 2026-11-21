import { describe, expect, test } from "bun:test";
import { validateConfig, type EarlyFindsLedger } from "@gitforage/core";
import { renderSite } from "../src/index.ts";

const NOW = "2026-12-12T12:00:00.000Z";
const cfg = validateConfig({ topics: ["hl7"], profile: "Healthcare tools.", site: { repo: "acme/portal", title: "Acme portal" }, early_finds: { enabled: true } });
const CSP = `content="default-src &#39;none&#39;; style-src &#39;self&#39;; font-src &#39;self&#39;; script-src &#39;self&#39;; img-src &#39;self&#39; data:; base-uri &#39;none&#39;; form-action &#39;none&#39;"`;
const base = { first_seen: "2026-11-20T13:00:00.000Z", tracked_since: "2026-11-20", trending_from: "2026-11-20", hn_from: "2026-11-20" };

const ledger = (): EarlyFindsLedger => ({ version: 1, updated: NOW, repos: {
  "acme/tool": { ...base, trending_first: "2026-12-05", milestones: { "1000": "2026-12-08" }, stars_at_first_seen: 300 },
  "quiet/lib": { ...base, hn_first: { date: "2026-11-25", id: 9, points: 180 } },
  "same/day": { ...base, trending_first: "2026-11-20" },
  "huge/already": { ...base, stars_at_first_seen: 80000, milestones: { "50000": "2026-12-01" } },
  "never/trended": { ...base, stars_at_first_seen: 12, stars_last: 14 },
} });

const build = (l: EarlyFindsLedger | null, c = cfg) => renderSite(c, [], { now: NOW, earlyFinds: l });
const textOf = (p: string) => p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/ ([.,])/g, "$1");

describe("the Found early page", () => {
  const files = build(ledger());
  const page = files.get("early-finds/index.html")!;
  const text = textOf(page);

  test("is built at early-finds/, titled, and linked from every footer, the About page and the Backtest page", () => {
    expect(page).toContain("<h1>Found early</h1>");
    expect(page).toContain("<title>Found early · Acme portal</title>");
    for (const [p, body] of files) if (p.endsWith(".html")) expect(body).toMatch(/href="(\.\.\/)?early-finds\/index\.html">Found early</);
    expect(files.get("about.html")).toContain('<a href="early-finds/index.html">Found early</a> is the live record');
    expect(files.get("backtest.html")).toContain('<a href="early-finds/index.html">Found early</a> page.');
    expect(page).toContain('href="../backtest.html">Backtest (simulated)</a>');
  });

  test("headline: finds that later reached a signal, with the median lead", () => {
    // acme/tool: Trending 15 days after; quiet/lib: HN 5 days after. Median of 15 and 5.
    expect(text).toContain("2 finds later reached GitHub Trending, the Hacker News front page or a star milestone, a median of 10 days after gitforage first showed them.");
    expect(text).toContain("Of those, 1 reached Trending, 1 the HN front page and 1 a star milestone. 5 repos tracked since Nov 20, 2026.");
  });

  test("the table is sorted by lead and leaves out same-day and already-big repos", () => {
    const rows = [...page.matchAll(/<tr><th scope="row"><a href="([^"]+)">([^<]+)<\/a><\/th><td><time[^>]*>([^<]+)<\/time><\/td><td>(.*?)<\/td><td><time[^>]*>([^<]+)<\/time><\/td><td>(\d+)<\/td><\/tr>/g)]
      .map((m) => [m[1], m[2], m[3], m[4].replace(/<[^>]+>/g, ""), m[5], m[6]]);
    expect(rows).toEqual([
      ["https://github.com/acme/tool", "acme/tool", "Nov 20, 2026", "GitHub Trending (then 1,000 stars)", "Dec 5, 2026", "15"],
      ["https://github.com/quiet/lib", "quiet/lib", "Nov 20, 2026", "Hacker News front page", "Nov 25, 2026", "5"],
    ]);
    for (const n of ["same/day", "huge/already", "never/trended"]) expect(page).not.toContain(n);
  });

  test("says how it is counted, and stays apart from the simulation", () => {
    expect(text).toContain("This is the live record, not a simulation.");
    expect(text).toContain("since Nov 20, 2026 a daily check");
    expect(text).toContain("Only later counts.");
    expect(text).toContain("nothing simulated is counted here");
    // None of the Backtest's simulated numbers or names leak in, and the Backtest stays labelled.
    for (const s of ["floci-io", "54 days", "85 of", "replayed", "Replayed"]) expect(page).not.toContain(s);
    expect(files.get("backtest.html")).toContain("<h1>Backtest (simulated)</h1>");
    expect(files.get("backtest.html")).not.toContain("acme/tool");
    expect(page).not.toContain("—");
  });

  test("same CSP and scripts as every page; links only to GitHub repos and inside the site; no data-* or style", () => {
    expect(page).toContain(CSP);
    expect(page.match(/<script\b[^>]*>/g)).toEqual(['<script src="../assets/theme.js">', '<script src="../assets/site.js" defer>']);
    for (const [, u] of page.matchAll(/href="([^"]*)"/g)) {
      if (u.startsWith("https:")) expect(u).toMatch(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?(#[a-z-]+)?$/);
      else expect(u).toMatch(/^(\.\.\/)?[a-z0-9#][a-z0-9._/#-]*$/);
    }
    expect(page).not.toMatch(/\sdata-(?!lang-default|density|sort-default|fields-off|theme-|lang-toggle|pref-status|density-)[a-z-]+=/);
    expect(page).not.toMatch(/\sstyle=|<style/);
  });

  test("hostile ledger values are dropped before rendering, and the page stays inert", () => {
    const evil = ledger() as any;
    evil.repos["<script>alert(1)</script>/x"] = { ...base, trending_first: "2026-12-01" };
    evil.repos["javascript:alert(1)//x"] = { ...base, trending_first: "2026-12-01" };
    evil.repos['a/b" onmouseover="x'] = { ...base, trending_first: "2026-12-01" };
    evil.repos["ok/name"] = { ...base, first_seen: '2026-11-20"><img src=x onerror=alert(2)>', trending_first: "2026-12-01" };
    evil.repos["ok/two"] = { ...base, trending_first: "<b>2026-12-01</b>", hn_first: { date: "2026-12-02", id: "1;drop", points: 5 } };
    const p = build(evil).get("early-finds/index.html")!;
    for (const s of ["<script>alert", "javascript:", "onmouseover", "onerror", "<img", "<b>", "ok/name", "ok/two"]) expect(p).not.toContain(s);
    expect(p).toContain(CSP);
    expect(textOf(p)).toContain("2 finds later reached");
  });

  test("with no qualifying finds the page still shows, with when tracking began", () => {
    const quiet: EarlyFindsLedger = { version: 1, updated: NOW, repos: { "same/day": { ...base, trending_first: "2026-11-20" }, "x/y": { ...base, tracked_since: "2026-11-22" } } };
    const p = build(quiet).get("early-finds/index.html")!;
    expect(textOf(p)).toContain("Tracking since Nov 20, 2026, nothing has reached Trending yet.");
    expect(p).not.toContain("<table>");
    expect(p).toContain(CSP);
  });

  test("no page and no links without a ledger, or with an empty or invalid one", () => {
    for (const l of [null, { version: 1, updated: "", repos: {} }, { version: 2, repos: { "a/b": base } } as any, { version: 1, repos: { "../x": base } } as any]) {
      const f = build(l);
      expect(f.has("early-finds/index.html")).toBe(false);
      for (const [p, body] of f) if (p.endsWith(".html")) expect(body).not.toContain("early-finds/");
    }
  });
});
