// Rising older repos: established repos (created before filters.max_age_days) in your
// topics and keywords that were pushed recently and are gaining stars fast.
//
// Growth comes from state/stars.json (see observations.ts): the star count seen on an
// earlier run. On the first run there is no baseline, so this source only records
// counts and finds nothing; from the second run (a few days later) on, it works.

import type { Config } from "../config.ts";
import type { GitHub } from "../github.ts";
import { growthOf, type StarsState } from "../observations.ts";
import { DAY_MS, isoDate, toRepo, type Repo } from "../types.ts";
import type { Pool } from "./pool.ts";
import { noteVia, type QueryKind } from "./search.ts";

export function risingQueries(cfg: Config, now: number, extra: string[] = []): { kind: QueryKind; term: string; q: string }[] {
  const L = cfg.limits;
  const before = isoDate(now - cfg.filters.max_age_days * DAY_MS);
  const pushed = isoDate(now - L.rising_push_days * DAY_MS);
  const tail = `created:<${before} pushed:>=${pushed} stars:>=${Math.max(cfg.filters.min_stars, L.rising_min_stars)} archived:false`;
  return [
    ...cfg.topics.map((t) => ({ kind: "topic" as const, term: t, q: `topic:${t} ${tail}` })),
    ...cfg.keywords.map((k) => ({ kind: "keyword" as const, term: k, q: `"${k.replace(/"/g, "")}" in:name,description ${tail}` })),
    ...extra.filter((t) => !cfg.topics.includes(t)).map((t) => ({ kind: "catalog" as const, term: t, q: `topic:${t} ${tail}` })),
  ];
}

/** Monthly growth that counts as rising: at least rising_min_growth stars, and at least 1% of the repo's stars. */
export const isRising = (perMonth: number, stars: number, minGrowth: number) =>
  perMonth >= minGrowth && perMonth >= stars * 0.01;

/**
 * Adds repos whose observed growth qualifies. Every repo the searches return is pushed
 * to `observed`, so the caller can record its star count for the next run.
 */
export async function risingSource(
  gh: GitHub, cfg: Config, pool: Pool, stars: StarsState, now: number, observed: Repo[], extra: string[] = [],
): Promise<number> {
  const L = cfg.limits;
  if (L.rising_per_query === 0) return 0;
  let found = 0;
  for (const { kind, term, q } of risingQueries(cfg, now, extra)) {
    const path = `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${L.rising_per_query}`;
    const res = await gh.get<{ items: any[] }>(path, { allow: [422] });
    for (const raw of (res?.items ?? []).slice(0, L.rising_per_query)) {
      const repo = toRepo(raw);
      if (!repo) continue;
      observed.push(repo);
      const g = growthOf(repo, stars, now);
      if (!g || !isRising(g.per_month, repo.stars, L.rising_min_growth)) continue;
      const c = pool.add(repo, "rising");
      if (!c) continue;
      noteVia(c, kind, term);
      found++;
    }
  }
  return found;
}
