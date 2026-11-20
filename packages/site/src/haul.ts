// The Haul: a numbered weekly issue of three picks, with its own page, index and feed.
//
// Issues are derived from state/digests on every build, so the Haul needs no state
// file of its own and two builds from the same state give the same issues. Discover
// digests are grouped by week (Monday to Sunday, UTC). Each week's issue takes its
// three best-scored finds that no earlier issue carried, in the portal's languages.
// Weeks are numbered from the oldest kept digest, and a week with nothing new gets no
// number, so numbers only ever grow as weeks are added.
//
// The owner can add a one-line note to an issue in haul.txt (next to interests.yml),
// one "NNN: text" line per issue. It is the owner's text but it is still cleaned,
// capped and escaped like repo text. A missing or empty note is simply left out.

import { cleanText, repoUrl, type Digest, type DigestItem } from "@gitforage/core";
import { xmlEscape } from "./feed.ts";
import { href, html, type Html } from "./html.ts";
import { card, fmtDate, langMatches, page, type SiteContext } from "./render.ts";

export const HAUL_PICKS = 3;
/** Most characters kept from an issue's note. */
export const MAX_HAUL_NOTE = 280;
/** Largest haul.txt read. */
export const MAX_HAUL_NOTES_BYTES = 64 * 1024;
/** Most issues in the Haul feed. */
export const MAX_HAUL_FEED_ENTRIES = 52;

export interface HaulIssue {
  number: number;
  /** Monday of the issue's week, YYYY-MM-DD. */
  week: string;
  /** When the week's last discover digest was written (ISO). */
  published: string;
  picks: DigestItem[];
  note: string;
}

/** The Monday (UTC) of a YYYY-MM-DD date's week. */
export function weekStart(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(t)) throw new Error(`bad digest date ${date}`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

/** Issue numbers as they appear in paths and titles: at least three digits. */
export const issueId = (n: number) => {
  if (!Number.isInteger(n) || n < 1 || n > 99_999) throw new Error("bad issue number");
  return String(n).padStart(3, "0");
};

/**
 * Parse haul.txt: blank lines and lines starting with # are skipped; every other line
 * must be "NNN: text". Text is cleaned of control and bidi characters and capped.
 */
export function parseHaulNotes(text: string): { notes: Map<number, string>; problems: string[] } {
  const notes = new Map<number, string>();
  const problems: string[] = [];
  if (text.length > MAX_HAUL_NOTES_BYTES) return { notes, problems: ["haul.txt: larger than 64 KB, ignored"] };
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const m = /^(\d{1,5}):[ \t]*(.*)$/.exec(t);
    const n = m ? Number(m[1]) : 0;
    if (!m || n < 1) { problems.push(`haul.txt line ${i + 1}: expected "NNN: one line of text"`); return; }
    if (notes.has(n)) problems.push(`haul.txt line ${i + 1}: a second note for issue ${n}; the last one is used`);
    const note = cleanText(m[2], MAX_HAUL_NOTE);
    if (note) notes.set(n, note); else notes.delete(n);
  });
  return { notes, problems };
}

const byScore = (a: DigestItem, b: DigestItem) =>
  b.score - a.score || (a.full_name.toLowerCase() < b.full_name.toLowerCase() ? -1 : a.full_name.toLowerCase() > b.full_name.toLowerCase() ? 1 : 0);

/** Every issue, oldest first. */
export function haulIssues(ctx: SiteContext, digests: Digest[], notes: Map<number, string> = new Map()): HaulIssue[] {
  const weeks = new Map<string, Digest[]>();
  for (const d of digests) {
    if (d.mode !== "discover") continue;
    const w = weekStart(d.date);
    weeks.set(w, [...(weeks.get(w) ?? []), d]);
  }
  const shown = new Set<string>();
  const issues: HaulIssue[] = [];
  for (const week of [...weeks.keys()].sort()) {
    const ds = weeks.get(week)!;
    const best = new Map<string, DigestItem>();
    for (const d of ds) {
      for (const it of d.items) {
        const k = it.full_name.toLowerCase();
        if (shown.has(k) || !repoUrl(it.full_name) || !Number.isFinite(it.score) || !langMatches(ctx.cfg, it.lang)) continue;
        const had = best.get(k);
        if (!had || it.score > had.score) best.set(k, it);
      }
    }
    const picks = [...best.values()].sort(byScore).slice(0, HAUL_PICKS);
    if (!picks.length) continue;
    for (const p of picks) shown.add(p.full_name.toLowerCase());
    const number = issues.length + 1;
    const published = ds.map((d) => d.generated_at).sort().at(-1)!;
    issues.push({ number, week, published, picks, note: notes.get(number) ?? "" });
  }
  return issues;
}

const issueTitle = (n: number) => `The Haul, No. ${issueId(n)}`;
const HAUL_LEDE = "Three finds a week, numbered like plates in a field guide. Each issue keeps the best new finds of its week that no earlier issue carried.";

export function haulIssuePage(ctx: SiteContext, issues: HaulIssue[], i: number): string {
  const is = issues[i];
  const prev = issues[i - 1], next = issues[i + 1];
  const body = html`<p class="crumbs"><a href="${href("index.html")}">The Haul</a></p>
<h1>${issueTitle(is.number)}</h1>
<p class="run-line">Brought home the week of <time datetime="${is.week}">${fmtDate(`${is.week}T00:00:00Z`)}</time>. ${is.picks.length === 1 ? "One pick" : `${is.picks.length === 2 ? "Two" : "Three"} picks`}, best fit first.</p>
${is.note ? html`<p class="lede haul-note">${is.note}</p>` : ""}
<ol class="cards">
${is.picks.map((it, rank) => card(ctx, it, { health: false, found: is.published, rank }))}
</ol>
<p class="run-line">${prev ? html`<a href="${href(`${issueId(prev.number)}.html`)}" rel="prev">No. ${issueId(prev.number)}</a>` : ""}${prev && next ? " · " : ""}${next ? html`<a href="${href(`${issueId(next.number)}.html`)}" rel="next">No. ${issueId(next.number)}</a>` : ""}${prev || next ? " · " : ""}<a href="${href("feed.xml")}">Haul feed</a></p>`;
  return page(ctx, { title: issueTitle(is.number), description: `${issueTitle(is.number)}: ${is.picks.map((p) => p.full_name).join(", ")}`, root: "../", path: `haul/${issueId(is.number)}.html`, nav: "archive", body });
}

export function haulIndexPage(ctx: SiteContext, issues: HaulIssue[]): string {
  const rows = [...issues].reverse().map((is) => html`<li><a href="${href(`${issueId(is.number)}.html`)}">No. ${issueId(is.number)}</a> <span class="arch-date">${fmtDate(`${is.week}T00:00:00Z`)}</span> <span class="muted">${is.picks.map((p) => p.full_name).join(", ")}</span></li>`);
  const body = html`<h1>The Haul</h1>
<p class="lede">${HAUL_LEDE}</p>
<p class="run-line">Follow it with the <a href="${href("feed.xml")}">Haul feed</a>, or see every walk in <a href="${href("../archive/index.html")}">the archive</a>.</p>
${rows.length ? html`<ul class="archive">${rows}</ul>` : html`<p class="empty">No issues yet. The first one comes with the first walk.</p>`}`;
  return page(ctx, { title: "The Haul", description: HAUL_LEDE, root: "../", path: "haul/index.html", nav: "archive", body });
}

/** Atom feed of the issues, newest first, each carrying its picks as HTML for email. */
export function haulFeed(ctx: SiteContext, issues: HaulIssue[]): string {
  const base = ctx.baseUrl;
  const entries = [...issues].reverse().slice(0, MAX_HAUL_FEED_ENTRIES).map((is) => {
    const id = issueId(is.number);
    const content: Html = html`${is.note ? html`<p>${is.note}</p>` : ""}<ol>${is.picks.map((p) => html`<li><a href="${href(repoUrl(p.full_name)!)}">${p.full_name}</a>${p.description ? html`: ${p.description}` : ""}</li>`)}</ol>`;
    const summary = [is.note, is.picks.map((p) => p.full_name).join(", ")].filter(Boolean).join(" ");
    return [
      "  <entry>",
      `    <title>${xmlEscape(issueTitle(is.number))}</title>`,
      `    <id>${xmlEscape(base ? `${base}haul/${id}.html` : `urn:gitforage:haul:${id}`)}</id>`,
      ...(base ? [`    <link rel="alternate" type="text/html" href="${xmlEscape(`${base}haul/${id}.html`)}"/>`] : []),
      `    <updated>${xmlEscape(is.published)}</updated>`,
      `    <summary type="text">${xmlEscape(summary)}</summary>`,
      `    <content type="html">${xmlEscape(content.value)}</content>`,
      "  </entry>",
    ].join("\n");
  });
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xmlEscape(`${ctx.cfg.site.title}: The Haul`)}</title>`,
    "  <subtitle>Three finds a week from gitforage</subtitle>",
    `  <id>${xmlEscape(base ? `${base}haul/feed.xml` : "urn:gitforage:haul")}</id>`,
    ...(base ? [`  <link rel="self" type="application/atom+xml" href="${xmlEscape(`${base}haul/feed.xml`)}"/>`, `  <link rel="alternate" type="text/html" href="${xmlEscape(`${base}haul/index.html`)}"/>`] : []),
    `  <updated>${xmlEscape(issues.at(-1)?.published ?? ctx.updated)}</updated>`,
    "  <author><name>gitforage</name></author>",
    '  <generator uri="https://github.com/iacsha/gitforage">gitforage</generator>',
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}

/** The Haul's files: haul/index.html, haul/NNN.html for every issue, haul/feed.xml. */
export function haulFiles(ctx: SiteContext, digests: Digest[], notes?: Map<number, string>): Map<string, string> {
  const issues = haulIssues(ctx, digests, notes);
  const files = new Map<string, string>();
  files.set("haul/index.html", haulIndexPage(ctx, issues));
  issues.forEach((is, i) => files.set(`haul/${issueId(is.number)}.html`, haulIssuePage(ctx, issues, i)));
  files.set("haul/feed.xml", haulFeed(ctx, issues));
  return files;
}
