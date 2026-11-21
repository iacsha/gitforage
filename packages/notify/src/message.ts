// One short message per run: the date, the top items of each digest written that day
// (name, score, top reason) and a link to the portal. Built once as data, then rendered
// per channel with that channel's escaping and size limit.

import { cleanText, isSafeFullName, normaliseBaseUrl, repoUrl, type Digest, type Mode } from "@gitforage/core";
import { defang, discordEscape, fitBlocks, safeText, slackEscape, telegramEscape, utf8Length } from "./text.ts";

export interface SummaryItem {
  mode: Mode;
  full_name: string;
  /** Rebuilt from the validated name with repoUrl, never read from the digest. */
  url: string;
  score: number;
  /** The highest-scoring reason, cleaned and defanged; null when there is none. */
  reason: string | null;
}

export interface SummarySection { mode: Mode; label: string; items: SummaryItem[]; total: number }

export interface Summary {
  title: string;
  date: string;
  sections: SummarySection[];
  /** Validated portal base URL, or null. */
  portal: string | null;
  /** New finds across the sections (all of them, not only the top ones shown). */
  total: number;
}

/** Size limits per API, in the unit each one counts. */
export const LIMITS = {
  /** ntfy: messages over 4,096 bytes become attachments. */
  ntfy: 4096,
  /** Telegram sendMessage: 4,096 characters of text. Counted on the HTML source, which is never shorter. */
  telegram: 4096,
  /** Slack: text over 4,000 characters is truncated or split. */
  slack: 4000,
  /** Discord: content is at most 2,000 characters. */
  discord: 2000,
  /** The generic JSON webhook's plain text field. */
  json: 4000,
} as const;

const LABELS: Record<Mode, string> = { discover: "Discover", contribute: "Get involved" };
const REASON_MAX = 120;

/** The top reason of a digest item: the one with the most points (the first on a tie). */
function topReason(reasons: { points: number; text: string }[]): string | null {
  let best: { points: number; text: string } | null = null;
  for (const r of reasons) if (r.points > 0 && r.text && (!best || r.points > best.points)) best = r;
  return best ? safeText(best.text, REASON_MAX) : null;
}

/**
 * Summarise the digests of one date. Only items with a plain owner/repo name are kept,
 * and links are rebuilt from the name. `portal` must already be a validated base URL
 * (site.url or the Pages URL); it is checked again here.
 */
export function buildSummary(digests: Digest[], o: { date: string; top: number; portal: string | null; title?: string }): Summary {
  const sections: SummarySection[] = [];
  for (const d of digests) {
    if (d.date !== o.date) continue;
    const items: SummaryItem[] = [];
    let total = 0;
    for (const it of d.items) {
      const url = repoUrl(it.full_name);
      if (!url || !isSafeFullName(it.full_name)) continue;
      total++;
      if (items.length < o.top) items.push({ mode: d.mode, full_name: it.full_name, url, score: Math.round(it.score), reason: topReason(it.reasons) });
    }
    if (total) sections.push({ mode: d.mode, label: LABELS[d.mode], items, total });
  }
  const portal = o.portal ? normaliseBaseUrl(o.portal) : null;
  const title = cleanText(o.title ?? "gitforage", 80) || "gitforage";
  return { title, date: o.date, sections, portal, total: sections.reduce((n, s) => n + s.total, 0) };
}

const finds = (n: number) => `${n} new ${n === 1 ? "find" : "finds"}`;

/** Item blocks for one format: a section label line before each section's first item. */
function blocks(s: Summary, label: (t: string) => string, item: (it: SummaryItem, n: number) => string): string[] {
  const out: string[] = [];
  for (const sec of s.sections) {
    sec.items.forEach((it, i) => out.push(`${i === 0 ? `\n${label(sec.label)}\n` : ""}${item(it, i + 1)}`));
  }
  return out;
}

const scoreReason = (it: SummaryItem) => `(${it.score})${it.reason ? `: ${it.reason}` : ""}`;

/** Plain text: ntfy's body and the JSON webhook's text. Names are defanged; each link is on its own line. */
export function renderPlain(s: Summary, limit: number = LIMITS.ntfy, measure: (t: string) => number = utf8Length): string {
  const head = `${defang(s.title)}, ${s.date}: ${finds(s.total)}`;
  const body = blocks(s, (l) => l, (it, n) => `${n}. ${defang(it.full_name)} ${scoreReason(it)}\n${it.url}`);
  const foot = s.portal ? `\nAll of them: ${s.portal}` : "";
  return fitBlocks(head, body, foot, limit, measure);
}

/** Telegram, parse_mode HTML. Every text goes through telegramEscape; the only hrefs are repo links and the portal. */
export function renderTelegram(s: Summary): string {
  const e = telegramEscape;
  const head = `<b>${e(s.title)}</b>, ${e(s.date)}: ${finds(s.total)}`;
  const body = blocks(s, (l) => `<b>${e(l)}</b>`, (it, n) => `${n}. <a href="${e(it.url)}">${e(it.full_name)}</a> ${e(scoreReason(it))}`);
  const foot = s.portal ? `\n<a href="${e(s.portal)}">All of them on the portal</a>` : "";
  return fitBlocks(head, body, foot, LIMITS.telegram);
}

/** Slack mrkdwn. &, < and > are escaped in every text; links use Slack's <url|label> form. */
export function renderSlack(s: Summary): string {
  const e = slackEscape;
  const head = `*${e(s.title)}*, ${e(s.date)}: ${finds(s.total)}`;
  const body = blocks(s, (l) => `*${e(l)}*`, (it, n) => `${n}. <${it.url}|${e(it.full_name)}> ${e(scoreReason(it))}`);
  const foot = s.portal ? `\n<${s.portal}|All of them on the portal>` : "";
  return fitBlocks(head, body, foot, LIMITS.slack);
}

/** Discord markdown. Text is escaped and mentions neutralised; links sit in <> so they do not embed. */
export function renderDiscord(s: Summary): string {
  const e = (t: string) => discordEscape(defang(t));
  const head = `**${e(s.title)}**, ${s.date}: ${finds(s.total)}`;
  const body = blocks(s, (l) => `**${e(l)}**`, (it, n) => `${n}\\. ${e(it.full_name)} ${discordEscape(scoreReason(it))}\n<${it.url}>`);
  const foot = s.portal ? `\nAll of them: <${s.portal}>` : "";
  return fitBlocks(head, body, foot, LIMITS.discord);
}

/** The generic JSON webhook's body. */
export function renderJson(s: Summary): Record<string, unknown> {
  return {
    version: 1,
    source: "gitforage",
    date: s.date,
    title: s.title,
    total: s.total,
    portal: s.portal,
    text: renderPlain(s, LIMITS.json, (t) => t.length),
    items: s.sections.flatMap((sec) => sec.items.map((it) => ({ mode: it.mode, full_name: it.full_name, url: it.url, score: it.score, reason: it.reason }))),
  };
}
