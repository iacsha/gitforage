// Star-farm guard: flag repos whose star count is implausible for their real activity.
//
// Bought or botted stars arrive without the things real users bring: forks, issues,
// contributors. They also arrive fast, on young or tiny repos. Each check below is
// either strong (enough on its own) or weak (two are needed). Everything comes from
// the repo payload gitforage already has, the star history in state/stars.json, and
// optionally one contributors call for the top candidates (see signals.ts).

import { daysSince, type Candidate } from "./types.ts";

export interface StarFarmCheck {
  /** Why the stars look inflated, each a short phrase: "12 forks", "1 contributor". */
  evidence: string[];
  strong: number;
  weak: number;
}

/**
 * Stars within the first year that only a few dozen repos in GitHub's history have
 * at all (React has about 240,000, Linux about 200,000).
 */
export const FARM_FIRST_YEAR_STARS = 150_000;
/** Stars a month that is suspicious, but not proof, on its own. */
export const FARM_VELOCITY = 25_000;
/** Stars per fork above which forks are implausibly few (popular repos are about 2 to 25). */
export const FARM_STARS_PER_FORK_STRONG = 150;
export const FARM_STARS_PER_FORK_WEAK = 40;

const k = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n)));
const plural = (n: number, one: string, many = `${one}s`) => `${k(n)} ${n === 1 ? one : many}`;
const months = (days: number) => (days < 60 ? `${days} days` : `${Math.round(days / 30)} months`);

/**
 * Run every check. Returns null when nothing looks off. Fork-only candidates are
 * skipped unless `forks` is set: the revival radar checks a fork standing on its own.
 */
export function starFarmCheck(c: Candidate, now: number, o: { forks?: boolean } = {}): StarFarmCheck | null {
  const r = c.repo;
  const stars = r.stars;
  if (stars < 500 || (!o.forks && c.sources.every((s) => s === "fork"))) return null;
  const out: StarFarmCheck = { evidence: [], strong: 0, weak: 0 };
  const add = (strong: boolean, text: string) => {
    out.evidence.push(text);
    if (strong) out.strong++; else out.weak++;
  };
  let healthyForks = false;
  const age = Math.max(daysSince(r.created_at, now), 7);
  const perMonth = (stars / age) * 30;

  if (age <= 365 && stars >= FARM_FIRST_YEAR_STARS) add(true, `in ${months(age)}`);
  else if (age <= 365 && ((stars >= 50_000 && perMonth >= FARM_VELOCITY) || (age <= 90 && stars >= 5000 && perMonth >= 2500))) add(false, `in ${months(age)}`);

  if (r.forks !== undefined) {
    const perFork = stars / (r.forks + 1);
    healthyForks = perFork < 10;
    if (perFork >= FARM_STARS_PER_FORK_STRONG && stars >= 1000) add(true, plural(r.forks, "fork"));
    else if (perFork >= FARM_STARS_PER_FORK_WEAK) add(false, plural(r.forks, "fork"));
  }
  // open_issues counts open pull requests too; a busy repo always has a few.
  if (r.open_issues !== undefined && stars >= 5000 && r.open_issues <= 2) add(false, plural(r.open_issues, "open issue"));
  const contributors = c.signals?.contributors;
  if (typeof contributors === "number") {
    if (contributors <= 1 && stars >= 10_000) add(true, plural(contributors, "contributor"));
    else if (contributors <= 2 && stars >= 2000) add(false, plural(contributors, "contributor"));
  }
  if (r.size_kb !== undefined && r.size_kb > 0 && r.size_kb <= 200 && stars >= 5000) add(false, `${k(r.size_kb)} KB of code`);
  // A sudden spike: growth since the last run far above the repo's lifetime average.
  const g = c.growth;
  if (g && g.per_month >= 3000 && g.per_month >= 5 * perMonth) add(false, `+${k(g.delta)} in ${g.days}d`);

  // Plenty of forks is real use, so weak signals then need a third to agree.
  return out.strong >= 1 || out.weak >= (healthyForks ? 3 : 2) ? out : null;
}

/** The card reason: "stars look inflated: 470k stars, 12 forks, 1 contributor". */
export function starFarmText(c: Candidate, check: StarFarmCheck): string {
  // The velocity phrase ("in 7 months") is always first and reads on from the star count.
  const [first, ...rest] = check.evidence;
  const head = first.startsWith("in ") ? `${plural(c.repo.stars, "star")} ${first}` : `${plural(c.repo.stars, "star")}, ${first}`;
  return `stars look inflated: ${[head, ...rest].join(", ")}`;
}
