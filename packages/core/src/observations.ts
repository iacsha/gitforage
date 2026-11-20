// state/stars.json: star counts observed on earlier runs, so growth can be measured
// for repos too old for "stars / age" to mean anything.
//
// GitHub has no cheap "stars gained this month" for someone else's repo (the stargazer
// list with timestamps is hidden for repos you do not own), so gitforage remembers what
// it saw. Each run records the star count of every candidate it looked at; an entry is
// only replaced once it is RECORD_EVERY_DAYS old, so a second run on the same day
// cannot wipe out the baseline. Growth is (stars now - stars then) / days since.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isSafeFullName } from "./sanitize.ts";
import { DAY_MS, type Repo } from "./types.ts";

export interface Observation { stars: number; at: string }
export interface StarsState { version: 1; repos: Record<string, Observation> }

/** An observation is replaced only once it is this old. */
export const RECORD_EVERY_DAYS = 6;
/** Growth needs at least this much time between observations. */
export const MIN_GROWTH_DAYS = 3;
/** Observations not refreshed for this long are dropped. */
export const KEEP_DAYS = 180;
/** Most repos remembered; the stalest go first. */
export const MAX_OBSERVATIONS = 50_000;

export const emptyStars = (): StarsState => ({ version: 1, repos: {} });

/** Load and validate. Entries with an unsafe name, a bad count or a bad date are dropped. */
export function loadStars(path: string): StarsState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStars();
    throw e;
  }
  const data = JSON.parse(text);
  if (data?.version !== 1 || typeof data.repos !== "object" || data.repos === null || Array.isArray(data.repos)) {
    throw new Error(`${path} is not a gitforage stars file (expected {"version": 1, "repos": {...}})`);
  }
  const repos: Record<string, Observation> = {};
  for (const [k, v] of Object.entries(data.repos as Record<string, any>).slice(0, MAX_OBSERVATIONS)) {
    const stars = Number(v?.stars), at = String(v?.at ?? "");
    if (!isSafeFullName(k) || !Number.isFinite(stars) || stars < 0 || !Number.isFinite(Date.parse(at))) continue;
    repos[k.toLowerCase()] = { stars: Math.floor(stars), at };
  }
  return { version: 1, repos };
}

export interface Growth { delta: number; days: number; per_month: number }

export function growthOf(r: Repo, s: StarsState, now: number): Growth | null {
  const o = s.repos[r.full_name.toLowerCase()];
  if (!o) return null;
  const days = (now - Date.parse(o.at)) / DAY_MS;
  if (!(days >= MIN_GROWTH_DAYS)) return null;
  const delta = r.stars - o.stars;
  return { delta, days: Math.round(days), per_month: Math.round((delta / days) * 30 * 10) / 10 };
}

/** Record star counts, keeping a baseline at least RECORD_EVERY_DAYS old. Prunes stale entries. */
export function recordStars(s: StarsState, repos: Repo[], now: number): StarsState {
  const at = new Date(now).toISOString();
  for (const r of repos) {
    if (!isSafeFullName(r.full_name)) continue;
    const key = r.full_name.toLowerCase();
    const o = s.repos[key];
    if (!o || now - Date.parse(o.at) >= RECORD_EVERY_DAYS * DAY_MS) s.repos[key] = { stars: r.stars, at };
  }
  let entries = Object.entries(s.repos).filter(([, o]) => now - Date.parse(o.at) <= KEEP_DAYS * DAY_MS);
  if (entries.length > MAX_OBSERVATIONS) {
    entries = entries.sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at)).slice(0, MAX_OBSERVATIONS);
  }
  s.repos = Object.fromEntries(entries);
  return s;
}

/** Write atomically, keys sorted so the file diffs cleanly. */
export function saveStars(path: string, s: StarsState) {
  mkdirSync(dirname(path), { recursive: true });
  const sorted = { version: 1, repos: Object.fromEntries(Object.entries(s.repos).sort(([a], [b]) => a.localeCompare(b))) };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(sorted, null, 1) + "\n");
  renameSync(tmp, path);
}
