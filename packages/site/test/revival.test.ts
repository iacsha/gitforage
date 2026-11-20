import { describe, expect, test } from "bun:test";
import { validateConfig, type RevivalItem } from "@gitforage/core";
import { csp, esc, renderSite } from "../src/index.ts";
import { revivalNote } from "../src/render.ts";

const NOW = "2026-11-22T12:00:00.000Z";
const ago = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();

const config = (enabled = true) =>
  validateConfig({ topics: ["hl7", "fhir"], site: { repo: "acme/portal", title: "Acme portal" }, revival: { enabled } });

function rv(up: string, fork: string, o: Partial<RevivalItem> = {}, f: Partial<RevivalItem["fork"]> = {}): RevivalItem {
  return {
    upstream: { full_name: up, stars: 900, archived: false, pushed_at: ago(800), topic: "hl7" },
    fork: { full_name: fork, stars: 40, open_issues: 2, created_at: ago(400), pushed_at: ago(3), ahead_by: 37, behind_by: 2, release: { tag: "v2.1.0", published_at: ago(10) }, ...f },
    points_here: false, checked_at: ago(1), ...o,
  };
}

describe("revival page", () => {
  test("off by default: no page and no tab", () => {
    const files = renderSite(config(false), [], { now: NOW, revival: [rv("old/engine", "carry/engine")] });
    expect(files.has("revival.html")).toBe(false);
    expect(files.get("index.html")).not.toContain("revival.html");
  });

  test("the card shows parent and fork, and the tab sits after Get involved", () => {
    const files = renderSite(config(), [], { now: NOW, revival: [rv("gone/archived", "heir/archived", { points_here: true, upstream: { full_name: "gone/archived", stars: 400, archived: true, pushed_at: ago(30), topic: "hl7" } }), rv("old/engine", "carry/engine")] });
    const page = files.get("revival.html")!;
    expect(page).toContain('<a href="revival.html" aria-current="page">Revivals</a>');
    const index = files.get("index.html")!;
    expect(index.indexOf("involved.html")).toBeLessThan(index.indexOf('href="revival.html"'));
    expect(index.indexOf('href="revival.html"')).toBeLessThan(index.indexOf("topics/index.html"));
    expect(page).toContain('href="https://github.com/carry/engine"');
    expect(page).toContain('href="https://github.com/old/engine"');
    expect(page).toContain("37 commits ahead");
    expect(page).toContain("dormant since");
    expect(page).toContain("archived, last push");
    expect(page).toContain("Upstream points here");
    expect(page).toContain("<code>v2.1.0</code>");
    // Upstream-points-here cards come first, in the order given.
    expect(page.indexOf("heir/archived")).toBeLessThan(page.indexOf("carry/engine"));
    expect(page).toContain(`content="${esc(csp(config().site))}"`);
  });

  test("hostile values are escaped or dropped, and only rebuilt GitHub links appear", () => {
    const items = [
      rv("old/engine", "carry/engine", {}, { release: { tag: `"><script>alert(1)</script>‮`, published_at: ago(3) } }),
      rv("<img src=x onerror=alert(1)>/x", "a/b"),
      rv("ok/up", "javascript:alert(1)/x"),
      rv("ok/up", "ok/up"),
      rv("ok/two", "fork/two", { upstream: { full_name: "ok/two", stars: 1, archived: false, pushed_at: "<b>", topic: `"><b>` } as any }),
      { nonsense: true } as any,
    ];
    const page = renderSite(config(), [], { now: NOW, revival: items }).get("revival.html")!;
    expect(page).not.toContain("<script>alert");
    expect(page).not.toContain("onerror=");
    expect(page).not.toContain("javascript:");
    expect(page).not.toContain("‮");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    const hrefs = [...page.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    for (const h of hrefs) expect(h).toMatch(/^(https:\/\/github\.com\/[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?(#[a-z-]+)?|[a-z0-9][a-z0-9._/-]*(#[A-Za-z0-9_.-]+)?|#main)$/);
    expect(page.match(/class="card revival-card"/g)).toHaveLength(2);
    expect(page).not.toMatch(/style=|<script>(?!<\/script>)/);
    for (const [, n] of page.matchAll(/\s(data-[a-z-]+)/g)) expect(["data-card", "data-lang-default", "data-density", "data-sort-default", "data-fields-off", "data-lang-toggle", "data-theme-toggle", "data-theme-label", "data-density-group", "data-density-option", "data-pref-status"]).toContain(n);
  });

  test("empty radar has a field-guide empty state", () => {
    const page = renderSite(config(), [], { now: NOW, revival: [] }).get("revival.html")!;
    expect(page).toContain("No revivals spotted yet.");
  });

  test("the field note is built from validated fields only", () => {
    const note = revivalNote(rv("old/engine", "carry/engine", { points_here: true }), NOW, ["hl7"]);
    expect(note).toContain("hl7 patch");
    expect(note).toContain("dormant for 2 years");
    expect(note).toContain("37 commits past its parent");
    expect(note).toContain("this week");
    expect(note).toContain("a release in the last 90 days");
    expect(note).toContain("points here");
    // A topic outside the allow-list is never named; one commit is singular.
    const other = revivalNote(rv("old/engine", "carry/engine", { upstream: { full_name: "old/engine", stars: 1, archived: true, pushed_at: ago(5), topic: "secret" } }, { ahead_by: 1, release: null, pushed_at: ago(100) }), NOW, ["hl7"]);
    expect(other).not.toContain("secret");
    expect(other).toContain("ff the usual trails");
    expect(other).toContain("archived");
    expect(other).toContain("1 commit past");
    expect(other).toContain("within six months");
    expect(other).not.toContain("release");
  });
});
