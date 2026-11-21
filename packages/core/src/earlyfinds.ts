// Early finds: the live record of repos this portal showed before they got big.
//
// For every repo in state/seen.json, state/early-finds.json keeps when the portal first
// showed it and watches, once a day, for three later "it got big" signals:
//   - GitHub Trending (daily, all languages), scraped from github.com/trending;
//   - the Hacker News front page, through the Algolia API (stories linking the repo);
//   - star milestones (1k, 5k, 10k, 25k, 50k) crossed after the first check.
// The site's Found early page is built from it. A "lead" is the days from first shown
// to the signal, and only leads of at least a day count: a repo that was already
// trending or already past a milestone when it was first shown is not an early find.
//
// Trending HTML and HN JSON are untrusted, like everything from GitHub. Only names
// that pass isSafeFullName are used, responses are size-capped and time-limited, and
// nothing but names, dates and counts is kept. The file itself sits in a git repo and
// is validated entry by entry when read.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GitHubError, RateLimitError, readCapped, type GitHub } from "./github.ts";
import { isSafeFullName } from "./sanitize.ts";
import type { SeenState } from "./state.ts";
import { DAY_MS, isoDate } from "./types.ts";

export const MILESTONES = [1000, 5000, 10000, 25000, 50000] as const;
/** Repo lookups (one core API call each) per run. */
export const MAX_STAR_CHECKS = 400;
/** A repo's stars are looked up again only once its last check is this old. */
export const STAR_RECHECK_DAYS = 6;
/** Stories from the last this many days are read from the HN front page. */
export const HN_WINDOW_DAYS = 2;
export const TRENDING_URL = "https://github.com/trending?since=daily";
export const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
/** Largest Trending page or HN response accepted. */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 30_000;
/** Trending lists 25 repos; anything past this many names is ignored. */
const MAX_TRENDING_NAMES = 100;
const MAX_HN_HITS = 500;
export const MAX_LEDGER_ENTRIES = 50_000;
export const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_COUNT = 1e9;

export interface EarlyFindEntry {
  /** When the portal first showed it (from state/seen.json), full ISO time. */
  first_seen: string;
  /** The first day this ledger watched it (YYYY-MM-DD). Signals on or before it are not credited. */
  tracked_since: string;
  /** Stars at the first lookup. */
  stars_at_first_seen?: number;
  /** First day it was seen on GitHub Trending. */
  trending_first?: string;
  /** The first day a Trending check succeeded while this repo was tracked. Trending is credited only after it. */
  trending_from?: string;
  /** The first day a Hacker News check succeeded while this repo was tracked. */
  hn_from?: string;
  /** First HN front-page story linking it. */
  hn_first?: { date: string; id: number; points: number };
  /** Milestone ("1000") to the day a lookup first saw it crossed. */
  milestones?: Record<string, string>;
  /** Stars at the latest lookup; -1 when the repo was gone (404). */
  stars_last?: number;
  /** When the stars were last looked up, full ISO time. */
  checked?: string;
}

export interface EarlyFindsLedger {
  version: 1;
  updated: string;
  /** By lowercase owner/repo. */
  repos: Record<string, EarlyFindEntry>;
}

export const emptyEarlyFinds = (): EarlyFindsLedger => ({ version: 1, updated: "", repos: {} });

// ---- validation -------------------------------------------------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** Dates before GitHub, or far in the future, are not real observations. */
const MIN_T = Date.parse("2008-01-01T00:00:00Z");
const MAX_T = Date.parse("2100-01-01T00:00:00Z");
const inRange = (t: number) => Number.isFinite(t) && t >= MIN_T && t < MAX_T;

/** A plain YYYY-MM-DD that is a real calendar day, or null. */
export function toDay(v: unknown): string | null {
  if (typeof v !== "string" || !DAY_RE.test(v)) return null;
  const t = Date.parse(`${v}T00:00:00Z`);
  return inRange(t) && isoDate(t) === v ? v : null;
}

/** A full ISO time in UTC (as toISOString writes it), normalised, or null. */
export function toIsoTime(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 30 || !ISO_RE.test(v)) return null;
  const t = Date.parse(v);
  return inRange(t) ? new Date(t).toISOString() : null;
}

const toCount = (v: unknown, min = 0): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= MAX_COUNT ? v : null;

/** Validate one entry read from disk. Returns null when a required field is off; bad optional fields are dropped. */
export function toEarlyFindEntry(v: unknown): EarlyFindEntry | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const first_seen = toIsoTime(o.first_seen);
  const tracked_since = toDay(o.tracked_since);
  if (!first_seen || !tracked_since) return null;
  const e: EarlyFindEntry = { first_seen, tracked_since };
  const s0 = toCount(o.stars_at_first_seen);
  if (s0 !== null) e.stars_at_first_seen = s0;
  const tr = toDay(o.trending_first);
  if (tr) e.trending_first = tr;
  const tf = toDay(o.trending_from);
  if (tf) e.trending_from = tf;
  const hf = toDay(o.hn_from);
  if (hf) e.hn_from = hf;
  const hn = o.hn_first as Record<string, unknown> | undefined;
  if (hn && typeof hn === "object" && !Array.isArray(hn)) {
    const date = toDay(hn.date), id = toCount(hn.id, 1), points = toCount(hn.points);
    if (date && id !== null && points !== null) e.hn_first = { date, id, points };
  }
  const ms = o.milestones;
  if (ms && typeof ms === "object" && !Array.isArray(ms)) {
    const kept: Record<string, string> = {};
    for (const m of MILESTONES) {
      const d = toDay((ms as Record<string, unknown>)[String(m)]);
      if (d) kept[String(m)] = d;
    }
    if (Object.keys(kept).length) e.milestones = kept;
  }
  const last = toCount(o.stars_last, -1);
  if (last !== null) e.stars_last = last;
  const checked = toIsoTime(o.checked);
  if (checked) e.checked = checked;
  return e;
}

/**
 * Validate a whole ledger (parsed JSON). Entries with a bad name or a bad required
 * field are dropped and reported; the rest are kept, keyed by lowercase name.
 */
export function validateEarlyFinds(data: unknown, source = "early-finds.json"): { ledger: EarlyFindsLedger; problems: string[] } {
  const d = data as Record<string, unknown> | null;
  if (typeof d !== "object" || d === null || d.version !== 1 || typeof d.repos !== "object" || d.repos === null || Array.isArray(d.repos)) {
    return { ledger: emptyEarlyFinds(), problems: [`${source}: expected {"version": 1, "repos": {...}}, ignored`] };
  }
  const problems: string[] = [];
  const repos: Record<string, EarlyFindEntry> = {};
  const all = Object.entries(d.repos as Record<string, unknown>);
  if (all.length > MAX_LEDGER_ENTRIES) problems.push(`${source}: more than ${MAX_LEDGER_ENTRIES} entries, the rest ignored`);
  for (const [name, v] of all.slice(0, MAX_LEDGER_ENTRIES)) {
    const k = name.toLowerCase();
    const e = isSafeFullName(name) ? toEarlyFindEntry(v) : null;
    if (!e || Object.hasOwn(repos, k)) { problems.push(`${source}: dropped entry ${isSafeFullName(name) ? name : "(bad name)"}`); continue; }
    repos[k] = e;
  }
  return { ledger: { version: 1, updated: toIsoTime(d.updated) ?? "", repos }, problems };
}

export function parseEarlyFinds(text: string, source = "early-finds.json"): { ledger: EarlyFindsLedger; problems: string[] } {
  if (text.length > MAX_LEDGER_BYTES) return { ledger: emptyEarlyFinds(), problems: [`${source}: larger than 16 MB, ignored`] };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ledger: emptyEarlyFinds(), problems: [`${source}: not valid JSON, ignored`] };
  }
  return validateEarlyFinds(data, source);
}

/** Load and validate state/early-finds.json. A missing file is an empty ledger. */
export function loadEarlyFinds(path: string): { ledger: EarlyFindsLedger; problems: string[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { ledger: emptyEarlyFinds(), problems: [] };
    throw e;
  }
  return parseEarlyFinds(text, path);
}

/** The ledger as JSON text, every object's keys sorted so the file diffs cleanly. */
export function earlyFindsJson(l: EarlyFindsLedger): string {
  const sortKeys = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(sortKeys(l), null, 1) + "\n";
}

/** Write atomically (temp file, then rename). */
export function saveEarlyFinds(path: string, l: EarlyFindsLedger) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, earlyFindsJson(l));
  renameSync(tmp, path);
}

// ---- parsing the outside sources --------------------------------------------------------

const TRENDING_RE = /<h2\b[^>]*class="[^"]*\blh-condensed\b[^"]*"[^>]*>\s*<a\b[^>]*?\bhref="\/([^"?#]{1,250})(?:[?#][^"]{0,250})?"/g;

/** Lowercase owner/repo names from the Trending page. Anything that is not a plain name is dropped. */
export function parseTrending(htmlText: string): string[] {
  const out = new Set<string>();
  for (const m of htmlText.matchAll(TRENDING_RE)) {
    const n = m[1].trim();
    if (isSafeFullName(n)) out.add(n.toLowerCase());
    if (out.size >= MAX_TRENDING_NAMES) break;
  }
  return [...out];
}

const GH_REPO_URL_RE = /^https?:\/\/(?:www\.)?github\.com\/([^/?#\s]+)\/([^/?#\s]+)(?:[/?#]|$)/i;

export interface HnHit { name: string; date: string; id: number; points: number }

/**
 * Front-page stories whose URL is a github.com repo, one per repo (the earliest).
 * The URL is only matched against the pattern; it is never kept or shown.
 */
export function parseHn(data: unknown): HnHit[] {
  const hits = (data as { hits?: unknown })?.hits;
  if (!Array.isArray(hits)) return [];
  const best = new Map<string, HnHit>();
  for (const h of hits.slice(0, MAX_HN_HITS)) {
    if (typeof h !== "object" || h === null) continue;
    const o = h as Record<string, unknown>;
    const m = typeof o.url === "string" && o.url.length <= 500 ? GH_REPO_URL_RE.exec(o.url) : null;
    if (!m) continue;
    const name = `${m[1]}/${m[2].replace(/\.git$/i, "")}`;
    if (!isSafeFullName(name)) continue;
    const t = Number(o.created_at_i) * 1000;
    const id = Number(o.objectID);
    const points = Number(o.points);
    if (!inRange(t) || !Number.isInteger(id) || id < 1 || id > MAX_COUNT) continue;
    const hit: HnHit = { name: name.toLowerCase(), date: isoDate(t), id, points: Number.isInteger(points) && points >= 0 && points <= MAX_COUNT ? points : 0 };
    const prev = best.get(hit.name);
    if (!prev || hit.date < prev.date) best.set(hit.name, hit);
  }
  return [...best.values()];
}

/** Milestones `stars` has reached that `before` had not, as strings ("1000"). */
export function crossedMilestones(before: number, stars: number): string[] {
  return MILESTONES.filter((m) => stars >= m && before < m).map(String);
}

// ---- the daily update -------------------------------------------------------------------

/** fetch for Trending and HN (injectable for tests). */
export type WebFetch = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export interface EarlyFindsRun {
  added: number;
  tracked: number;
  trendingToday: number | null;
  trendingHits: number;
  hnHits: number;
  checked: number;
  crossed: number;
  warnings: string[];
}

async function fetchCapped(fetchFn: WebFetch, url: string): Promise<string> {
  const host = new URL(url).host;
  const res = await fetchFn(url, { headers: { "User-Agent": "gitforage-early-finds", Accept: "text/html,application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`${host} answered ${res.status}`);
  }
  return readCapped(res, MAX_RESPONSE_BYTES, host);
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * One daily pass, updating `ledger` in place:
 *   1. add every repo in `seen` that is not tracked yet (first_seen from seen.json);
 *   2. mark tracked repos on today's GitHub Trending;
 *   3. mark tracked repos linked from HN front-page stories of the last two days;
 *   4. look up stars for up to MAX_STAR_CHECKS repos not checked in STAR_RECHECK_DAYS,
 *      least recently checked first, and note milestones crossed since the first lookup.
 * Trending or HN failing is a warning; the other steps still run. The caller saves.
 */
export async function updateEarlyFinds(gh: GitHub, seen: SeenState, ledger: EarlyFindsLedger, now: number, fetchFn: WebFetch): Promise<EarlyFindsRun> {
  const today = isoDate(now);
  const run: EarlyFindsRun = { added: 0, tracked: 0, trendingToday: null, trendingHits: 0, hnHits: 0, checked: 0, crossed: 0, warnings: [] };

  // 1. First-seen dates from the local seen state.
  for (const [name, v] of Object.entries(seen.seen ?? {})) {
    if (!isSafeFullName(name)) continue;
    const k = name.toLowerCase();
    if (Object.hasOwn(ledger.repos, k)) continue;
    if (Object.keys(ledger.repos).length >= MAX_LEDGER_ENTRIES) { run.warnings.push(`early finds: ledger is full (${MAX_LEDGER_ENTRIES} repos); not adding more`); break; }
    const first_seen = toIsoTime((v as { first_seen?: unknown })?.first_seen);
    if (!first_seen || Date.parse(first_seen) > now) continue;
    ledger.repos[k] = { first_seen, tracked_since: today };
    run.added++;
  }
  run.tracked = Object.keys(ledger.repos).length;

  // 2. GitHub Trending, daily.
  try {
    const names = parseTrending(await fetchCapped(fetchFn, TRENDING_URL));
    run.trendingToday = names.length;
    if (!names.length) run.warnings.push("early finds: no repos found on the Trending page (its layout may have changed)");
    // The check worked today: every tracked repo is now watched on Trending from today on.
    for (const e of Object.values(ledger.repos)) if (!e.trending_from) e.trending_from = today;
    for (const k of names) {
      const e = ledger.repos[k];
      if (e && Object.hasOwn(ledger.repos, k) && !e.trending_first) { e.trending_first = today; run.trendingHits++; }
    }
  } catch (e) {
    run.warnings.push(`early finds: Trending skipped: ${errText(e)}`);
  }

  // 3. Hacker News front page, last HN_WINDOW_DAYS days.
  try {
    const since = Math.floor(now / 1000) - HN_WINDOW_DAYS * 86_400;
    const url = `${HN_SEARCH_URL}?tags=front_page&hitsPerPage=200&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}`;
    let data: unknown;
    try {
      data = JSON.parse(await fetchCapped(fetchFn, url));
    } catch (e) {
      throw e instanceof SyntaxError ? new Error("HN answered with something that is not JSON") : e;
    }
    for (const e of Object.values(ledger.repos)) if (!e.hn_from) e.hn_from = today;
    for (const h of parseHn(data)) {
      const e = Object.hasOwn(ledger.repos, h.name) ? ledger.repos[h.name] : undefined;
      if (e && !e.hn_first) { e.hn_first = { date: h.date, id: h.id, points: h.points }; run.hnHits++; }
    }
  } catch (e) {
    run.warnings.push(`early finds: Hacker News skipped: ${errText(e)}`);
  }

  // 4. Star milestones, least recently checked first.
  const due = Object.entries(ledger.repos)
    .filter(([, e]) => !e.checked || now - Date.parse(e.checked) >= STAR_RECHECK_DAYS * DAY_MS)
    .sort(([a, x], [b, y]) => (x.checked ?? "").localeCompare(y.checked ?? "") || a.localeCompare(b))
    .slice(0, MAX_STAR_CHECKS);
  let failed = 0;
  for (const [k, e] of due) {
    if (!isSafeFullName(k)) continue;
    let r: any;
    try {
      r = await gh.get<any>(`/repos/${k}`, { allow: [404, 451], ttlMs: 3_600_000 });
    } catch (err) {
      if (err instanceof RateLimitError) { run.warnings.push("early finds: rate limited; the remaining star checks wait for the next run"); break; }
      if (err instanceof GitHubError) { failed++; continue; }
      throw err;
    }
    e.checked = new Date(now).toISOString();
    run.checked++;
    if (r === null) { e.stars_last = -1; continue; } // deleted, renamed away or blocked
    const stars = toCount(r?.stargazers_count);
    if (stars === null) continue;
    if (e.stars_at_first_seen === undefined) e.stars_at_first_seen = stars;
    for (const m of crossedMilestones(e.stars_at_first_seen, stars)) {
      if (!e.milestones?.[m]) { (e.milestones ??= {})[m] = today; run.crossed++; }
    }
    e.stars_last = stars;
  }
  if (failed) run.warnings.push(`early finds: ${failed} star lookups failed; they are retried next run`);
  ledger.updated = new Date(now).toISOString();
  return run;
}

// ---- leads ------------------------------------------------------------------------------

export type EarlySignal = "trending" | "hn" | "stars";

export interface EarlyEvent { kind: EarlySignal; date: string; lead: number; milestone?: number }

export interface EarlyFind {
  name: string;
  first_seen: string;
  /** Qualifying events (lead of at least one day), earliest first. */
  events: EarlyEvent[];
}

const dayNum = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/**
 * Days from first shown to an event, or null when it does not count: the event must
 * fall strictly after the day the repo was first shown and strictly after the day the
 * ledger started watching it (a repo found already trending on its first watched day
 * may have been trending before).
 */
export function leadDays(e: Pick<EarlyFindEntry, "first_seen" | "tracked_since">, eventDay: string): number | null {
  const ev = toDay(eventDay);
  const shown = toIsoTime(e.first_seen);
  const since = toDay(e.tracked_since);
  if (!ev || !shown || !since) return null;
  const lead = dayNum(ev) - dayNum(shown.slice(0, 10));
  return lead >= 1 && dayNum(ev) > dayNum(since) ? lead : null;
}

/** True when a source's first successful check came no later than the day after the repo was shown. */
function watchedFromShown(e: EarlyFindEntry, from: string | undefined): boolean {
  const shown = toIsoTime(e.first_seen), f = toDay(from);
  return Boolean(shown && f && dayNum(f) <= dayNum(shown.slice(0, 10)) + 1);
}

/** Repos with at least one qualifying event, longest first lead first. */
export function earlyFinds(l: EarlyFindsLedger): EarlyFind[] {
  const out: EarlyFind[] = [];
  for (const [name, e] of Object.entries(l.repos)) {
    const events: EarlyEvent[] = [];
    const add = (kind: EarlySignal, date: string | undefined, milestone?: number, from?: string) => {
      let lead = date ? leadDays(e, date) : null;
      if (lead !== null && from && dayNum(date!) <= dayNum(from)) lead = null;
      if (lead !== null) events.push({ kind, date: date!, lead, ...(milestone ? { milestone } : {}) });
    };
    // Trending and HN count only when that source was watched from (about) the day the repo
    // was shown: a backfilled repo, or one whose first checks failed, may have reached it unseen.
    if (watchedFromShown(e, e.trending_from)) add("trending", e.trending_first, undefined, e.trending_from);
    if (watchedFromShown(e, e.hn_from)) add("hn", e.hn_first?.date, undefined, e.hn_from);
    for (const m of MILESTONES) {
      // A milestone counts only with a known star count at the first lookup, below it.
      if (e.stars_at_first_seen === undefined || e.stars_at_first_seen >= m) continue;
      add("stars", e.milestones?.[String(m)], m);
    }
    if (!events.length) continue;
    events.sort((a, b) => a.lead - b.lead || a.kind.localeCompare(b.kind) || (a.milestone ?? 0) - (b.milestone ?? 0));
    out.push({ name, first_seen: e.first_seen, events });
  }
  return out.sort((a, b) => b.events[0].lead - a.events[0].lead || a.name.localeCompare(b.name));
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The earliest day the ledger watched anything, or null for an empty ledger. */
export function trackingSince(l: EarlyFindsLedger): string | null {
  let min: string | null = null;
  for (const e of Object.values(l.repos)) if (!min || e.tracked_since < min) min = e.tracked_since;
  return min;
}
