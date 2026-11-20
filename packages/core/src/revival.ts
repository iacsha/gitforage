// Revival radar: dead upstream, live fork.
//
// Within the config's own topics, find established repos that have gone dormant (no
// push for `revival.dormancy_months`, or archived) and look for a fork that carries
// them on: commits ahead of upstream, pushed recently, and some traction of its own.
//
// It builds on the wild-fork source (sources/forks.ts): the same forks listing, the
// same cheap isLiveFork pre-filter and the same compare call for ahead_by. What it
// adds is the other direction (start from a dormant upstream in your topics, not
// from a seed), the noise guards, a hard call budget, and state/revival.json so a
// weekly run only re-examines an upstream every RECHECK_DAYS.
//
// API cost per run, at most: two searches per topic (MAX_TOPICS topics), then for
// each of `revival.max_candidates` upstreams not checked recently, one forks listing,
// up to COMPARES_PER_UPSTREAM compares and one releases call. See revivalBudget.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "./config.ts";
import { exclusionReason } from "./exclude.ts";
import type { GitHub } from "./github.ts";
import { cleanText, isSafeFullName } from "./sanitize.ts";
import { isLiveFork } from "./sources/forks.ts";
import { starFarmCheck } from "./starfarm.ts";
import { DAY_MS, daysSince, isoDate, toRepo, type Repo } from "./types.ts";

/** Topics searched for dormant upstreams, in config order. */
export const MAX_TOPICS = 12;
/** Dormant upstreams read per search. */
export const UPSTREAMS_PER_SEARCH = 10;
/** An upstream needs this many stars to be worth reviving. */
export const MIN_UPSTREAM_STARS = 50;
/** Forks listed per upstream, most-starred first. */
export const FORKS_LISTED = 30;
/** Compare calls per upstream, most-starred surviving fork first; the first one ahead wins. */
export const COMPARES_PER_UPSTREAM = 3;
/** A carrying fork must have been pushed within this many days. */
export const FORK_PUSH_DAYS = 180;
/** A fork with this many open issues of its own has traction even with few stars (forks start with issues off). */
export const FORK_MIN_ISSUES = 3;
/** An upstream is examined again only once its last check is this old. */
export const RECHECK_DAYS = 28;
/** Checks older than this are dropped from state. */
export const REVIVAL_KEEP_DAYS = 180;
export const MAX_STATE_ENTRIES = 5000;
export const MAX_REVIVAL_ITEMS = 100;
const DAYS_PER_MONTH = 30.44;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;

export interface RevivalItem {
  upstream: { full_name: string; stars: number; archived: boolean; pushed_at: string; topic: string };
  fork: {
    full_name: string; stars: number; open_issues: number; created_at: string; pushed_at: string;
    ahead_by: number; behind_by: number; release: { tag: string; published_at: string } | null;
  };
  /** The upstream's homepage or description names the fork: it points here as the new home. */
  points_here: boolean;
  checked_at: string;
}

export interface RevivalCheck { at: string; item: RevivalItem | null }
export interface RevivalState {
  version: 1;
  generated_at: string;
  /** The last run's radar, newest check first. What the portal shows. */
  items: RevivalItem[];
  /** Every upstream examined, by lowercase name, so weekly runs do not re-query them. */
  checked: Record<string, RevivalCheck>;
}

export const emptyRevival = (): RevivalState => ({ version: 1, generated_at: "", items: [], checked: {} });

export interface RevivalRun {
  items: RevivalItem[];
  /** Upstreams examined with API calls this run, and reused from state. */
  examined: number;
  reused: number;
  /** Requests made (cache hits included), never more than budget. */
  calls: number;
  budget: number;
  warnings: string[];
}

/** The most calls one run may make. */
export function revivalBudget(cfg: Config): number {
  return 2 * Math.min(cfg.topics.length, MAX_TOPICS) + cfg.revival.max_candidates * (2 + COMPARES_PER_UPSTREAM);
}

export function isDormant(r: Repo, now: number, months: number): boolean {
  return r.archived || daysSince(r.pushed_at, now) >= months * DAYS_PER_MONTH;
}

/** Search queries for dormant upstreams: long unpushed, and archived within the dormancy window. */
export function revivalQueries(cfg: Config, now: number): { topic: string; q: string }[] {
  const cutoff = isoDate(now - cfg.revival.dormancy_months * DAYS_PER_MONTH * DAY_MS);
  const stars = Math.max(cfg.filters.min_stars, MIN_UPSTREAM_STARS);
  return cfg.topics.slice(0, MAX_TOPICS).filter((t) => TOPIC_RE.test(t)).flatMap((t) => [
    { topic: t, q: `topic:${t} stars:>=${stars} pushed:<${cutoff} fork:false` },
    { topic: t, q: `topic:${t} stars:>=${stars} pushed:>=${cutoff} archived:true fork:false` },
  ]);
}

const GH_LINK_RE = /github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)/g;
const PLAIN_NAME_RE = /(?:^|[\s(:,])([a-z0-9_.-]+\/[a-z0-9_.-]+)(?=$|[\s),;:!?]|\.(?:\s|$))/g;

/**
 * Whether the upstream names the fork as its new home: a github.com link to the fork
 * in its homepage or description, or the bare owner/name in the description. Only a
 * boolean comes out; the matched text is never shown.
 */
export function pointsHere(up: Repo, forkName: string): boolean {
  const want = forkName.toLowerCase();
  const norm = (s: string) => s.replace(/\.git$/, "").replace(/\.$/, "");
  const text = `${up.homepage} ${up.description}`.toLowerCase();
  for (const m of text.matchAll(GH_LINK_RE)) if (norm(m[1]) === want) return true;
  for (const m of up.description.toLowerCase().matchAll(PLAIN_NAME_RE)) if (norm(m[1]) === want) return true;
  return false;
}

/** Whether a fork shows traction of its own: stars, or issues opened on it. */
export const hasTraction = (f: Repo, minStars: number) => f.stars >= minStars || (f.open_issues ?? 0) >= FORK_MIN_ISSUES;

/**
 * Examine upstreams in the config's topics and return the revivals found. `state`
 * is read for recent checks and updated in place; the caller saves it.
 */
export async function revivalSource(gh: GitHub, cfg: Config, state: RevivalState, now: number): Promise<RevivalRun> {
  const budget = revivalBudget(cfg);
  const run: RevivalRun = { items: [], examined: 0, reused: 0, calls: 0, budget, warnings: [] };
  if (!cfg.revival.enabled || !cfg.topics.length) return run;
  const get = async <T>(path: string, allow: number[]): Promise<T | null> => {
    if (run.calls >= budget) throw new BudgetSpent();
    run.calls++;
    return gh.get<T>(path, { allow });
  };

  // 1. Dormant upstreams in your topics, most-starred first.
  const ups = new Map<string, { repo: Repo; topic: string }>();
  for (const { topic, q } of revivalQueries(cfg, now)) {
    const res = await get<{ items: any[] }>(`/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${UPSTREAMS_PER_SEARCH}`, [422]);
    for (const raw of (res?.items ?? []).slice(0, UPSTREAMS_PER_SEARCH)) {
      const r = toRepo(raw);
      if (!r || r.fork || r.disabled || !isDormant(r, now, cfg.revival.dormancy_months)) continue;
      if (cfg.exclude.owners.includes(r.owner.toLowerCase())) continue;
      const k = r.full_name.toLowerCase();
      if (!ups.has(k)) ups.set(k, { repo: r, topic });
    }
  }

  // 2. A carrying fork for each: from state when checked recently, else within the budget.
  const order = [...ups.values()].sort((a, b) => b.repo.stars - a.repo.stars);
  for (const { repo: up, topic } of order) {
    const key = up.full_name.toLowerCase();
    const prev = state.checked[key];
    let item: RevivalItem | null;
    if (prev && now - Date.parse(prev.at) < RECHECK_DAYS * DAY_MS) {
      run.reused++;
      item = prev.item;
    } else {
      if (run.examined >= cfg.revival.max_candidates) continue;
      run.examined++;
      try {
        item = await examine(up, topic, cfg, now, get);
      } catch (e) {
        if (e instanceof BudgetSpent) { run.warnings.push(`revival: call budget (${budget}) spent; the rest wait for the next run`); break; }
        throw e;
      }
      state.checked[key] = { at: new Date(now).toISOString(), item };
    }
    // The upstream's own numbers come from this run's search, not the cache.
    if (item) run.items.push({ ...item, upstream: upstreamOf(up, topic), points_here: item.points_here || pointsHere(up, item.fork.full_name) });
  }
  run.items.sort((a, b) => Number(b.points_here) - Number(a.points_here) || b.fork.stars - a.fork.stars || a.fork.full_name.localeCompare(b.fork.full_name));
  run.items = run.items.slice(0, MAX_REVIVAL_ITEMS);
  pruneRevival(state, now);
  state.items = run.items;
  state.generated_at = new Date(now).toISOString();
  return run;
}

class BudgetSpent extends Error {}

const upstreamOf = (up: Repo, topic: string): RevivalItem["upstream"] =>
  ({ full_name: up.full_name, stars: up.stars, archived: up.archived, pushed_at: up.pushed_at, topic });

type Get = <T>(path: string, allow: number[]) => Promise<T | null>;

async function examine(up: Repo, topic: string, cfg: Config, now: number, get: Get): Promise<RevivalItem | null> {
  if (!isSafeFullName(up.full_name)) return null;
  const listed = await get<any[]>(`/repos/${up.full_name}/forks?sort=stargazers&per_page=${FORKS_LISTED}`, [404]);
  const upCreated = Date.parse(up.created_at);
  const forks: Repo[] = [];
  const names = new Set<string>();
  for (const raw of (Array.isArray(listed) ? listed : []).slice(0, FORKS_LISTED)) {
    const f = toRepo(raw);
    if (!f) continue;
    const k = f.full_name.toLowerCase();
    // Renamed or transferred repos: a "fork" that is the upstream itself, a duplicate,
    // or one older than its parent is a redirect artefact, not a revival.
    if (k === up.full_name.toLowerCase() || names.has(k)) continue;
    if (Number.isFinite(upCreated) && Date.parse(f.created_at) < upCreated) continue;
    if (!isLiveFork(f, now, FORK_PUSH_DAYS) || !hasTraction(f, cfg.revival.min_fork_stars)) continue;
    const c = { repo: f, sources: ["fork" as const], via_topics: [], via_keywords: [] };
    if (exclusionReason(c, cfg, new Set()) || starFarmCheck(c, now, { forks: true })) continue;
    names.add(k);
    forks.push(f);
  }
  forks.sort((a, b) => b.stars - a.stars || Date.parse(b.pushed_at) - Date.parse(a.pushed_at));

  for (const f of forks.slice(0, COMPARES_PER_UPSTREAM)) {
    const base = encodeURIComponent(up.default_branch);
    const head = `${encodeURIComponent(f.owner)}:${encodeURIComponent(f.default_branch)}`;
    const cmp = await get<any>(`/repos/${up.full_name}/compare/${base}...${head}?per_page=1`, [404, 422]);
    const ahead = count(cmp?.ahead_by);
    if (ahead === 0) continue; // a mirror: nothing of its own
    const rel = await get<any[]>(`/repos/${f.full_name}/releases?per_page=1`, [404]);
    return {
      upstream: upstreamOf(up, topic),
      fork: {
        full_name: f.full_name, stars: f.stars, open_issues: f.open_issues ?? 0, created_at: f.created_at, pushed_at: f.pushed_at,
        ahead_by: ahead, behind_by: count(cmp?.behind_by), release: releaseOf(Array.isArray(rel) ? rel[0] : null),
      },
      points_here: pointsHere(up, f.full_name),
      checked_at: new Date(now).toISOString(),
    };
  }
  return null;
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.floor(v) : 0);
const iso = (v: unknown) => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : "");

function releaseOf(r: any): RevivalItem["fork"]["release"] {
  if (!r || r.draft) return null;
  const tag = cleanText(r.tag_name ?? "", 60);
  const published_at = iso(r.published_at);
  return tag && published_at ? { tag, published_at } : null;
}

/**
 * Validate one item read from disk (state/revival.json sits in a git repo and carries
 * strangers' text). Returns the cleaned item, or null when anything required is off.
 */
export function toRevivalItem(v: unknown): RevivalItem | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, any>;
  const u = o.upstream, f = o.fork;
  if (typeof u !== "object" || u === null || typeof f !== "object" || f === null) return null;
  const up = String(u.full_name ?? ""), fk = String(f.full_name ?? "");
  if (!isSafeFullName(up) || !isSafeFullName(fk) || up.toLowerCase() === fk.toLowerCase()) return null;
  const ahead = count(f.ahead_by);
  if (ahead < 1) return null;
  const rel = f.release && typeof f.release === "object" ? releaseOf({ tag_name: f.release.tag, published_at: f.release.published_at }) : null;
  return {
    upstream: { full_name: up, stars: count(u.stars), archived: u.archived === true, pushed_at: iso(u.pushed_at), topic: typeof u.topic === "string" && TOPIC_RE.test(u.topic) ? u.topic : "" },
    fork: {
      full_name: fk, stars: count(f.stars), open_issues: count(f.open_issues), created_at: iso(f.created_at), pushed_at: iso(f.pushed_at),
      ahead_by: ahead, behind_by: count(f.behind_by), release: rel,
    },
    points_here: o.points_here === true,
    checked_at: iso(o.checked_at),
  };
}

function pruneRevival(s: RevivalState, now: number) {
  let entries = Object.entries(s.checked).filter(([, c]) => now - Date.parse(c.at) <= REVIVAL_KEEP_DAYS * DAY_MS);
  if (entries.length > MAX_STATE_ENTRIES) entries = entries.sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_STATE_ENTRIES);
  s.checked = Object.fromEntries(entries);
}

export const MAX_REVIVAL_BYTES = 4 * 1024 * 1024;

/** Load and validate state/revival.json. Bad entries are dropped and counted in problems. */
export function loadRevival(path: string): { state: RevivalState; problems: string[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { state: emptyRevival(), problems: [] };
    throw e;
  }
  return parseRevival(text, path);
}

export function parseRevival(text: string, source = "revival.json"): { state: RevivalState; problems: string[] } {
  if (text.length > MAX_REVIVAL_BYTES) return { state: emptyRevival(), problems: [`${source}: larger than 4 MB, ignored`] };
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { state: emptyRevival(), problems: [`${source}: not valid JSON, ignored`] };
  }
  if (data?.version !== 1 || !Array.isArray(data.items) || typeof data.checked !== "object" || data.checked === null || Array.isArray(data.checked)) {
    return { state: emptyRevival(), problems: [`${source}: expected version 1 with items and checked`] };
  }
  const problems: string[] = [];
  const items: RevivalItem[] = [];
  const seen = new Set<string>();
  data.items.slice(0, MAX_REVIVAL_ITEMS).forEach((it: unknown, i: number) => {
    const r = toRevivalItem(it);
    if (!r) { problems.push(`${source} items[${i}]: dropped`); return; }
    const k = r.upstream.full_name.toLowerCase();
    if (!seen.has(k)) { seen.add(k); items.push(r); }
  });
  const checked: Record<string, RevivalCheck> = {};
  for (const [k, c] of Object.entries(data.checked as Record<string, any>).slice(0, MAX_STATE_ENTRIES)) {
    const at = iso(c?.at);
    if (!isSafeFullName(k) || !at) { problems.push(`${source} checked: dropped an entry`); continue; }
    const item = c.item === null ? null : toRevivalItem(c.item);
    if (c.item !== null && !item) { problems.push(`${source} checked: dropped an entry`); continue; }
    checked[k.toLowerCase()] = { at, item };
  }
  return { state: { version: 1, generated_at: iso(data.generated_at), items, checked }, problems };
}

/** Write atomically, keys sorted so the file diffs cleanly. */
export function saveRevival(path: string, s: RevivalState) {
  mkdirSync(dirname(path), { recursive: true });
  const sorted: RevivalState = { ...s, checked: Object.fromEntries(Object.entries(s.checked).sort(([a], [b]) => a.localeCompare(b))) };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(sorted, null, 1) + "\n");
  renameSync(tmp, path);
}

/** Plain text for the terminal (`preview`). Names are validated; the release tag was cleaned of control characters. */
export function revivalText(items: RevivalItem[]): string {
  const lines = ["Revival radar (dormant upstream, live fork):"];
  for (const it of items) {
    const u = it.upstream, f = it.fork;
    const since = u.archived ? "archived" : `quiet since ${u.pushed_at.slice(0, 10) || "unknown"}`;
    lines.push(`  ${u.full_name} (${since}) -> ${f.full_name}: ${f.ahead_by} ahead, pushed ${f.pushed_at.slice(0, 10)}, ${f.stars} stars` +
      `${f.release ? `, release ${cleanText(f.release.tag, 60)}` : ""}${it.points_here ? ", upstream points here" : ""}`);
  }
  return lines.join("\n");
}
