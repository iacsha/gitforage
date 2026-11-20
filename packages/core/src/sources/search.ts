// New and rising repos: one search per topic and per keyword, limited to repos created
// inside filters.max_age_days with at least filters.min_stars, sorted by stars.

import type { Config } from "../config.ts";
import type { GitHub } from "../github.ts";
import { DAY_MS, isoDate, toRepo } from "../types.ts";
import type { Candidate } from "../types.ts";
import type { Pool } from "./pool.ts";

export type QueryKind = "topic" | "keyword" | "catalog";

/** Records which query found a candidate: config topics and keywords, or catalog-only topics. */
export function noteVia(c: Candidate, kind: QueryKind, term: string): void {
  const list = kind === "topic" ? c.via_topics : kind === "keyword" ? c.via_keywords : (c.via_catalog ??= []);
  if (!list.includes(term)) list.push(term);
}

/**
 * One search per config topic and keyword, then one per extra catalog topic
 * (site.personalize topics that are not config topics).
 */
export function searchQueries(cfg: Config, now: number, extra: string[] = []): { kind: QueryKind; term: string; q: string }[] {
  const since = isoDate(now - cfg.filters.max_age_days * DAY_MS);
  const tail = `created:>=${since} stars:>=${cfg.filters.min_stars} archived:false`;
  return [
    ...cfg.topics.map((t) => ({ kind: "topic" as const, term: t, q: `topic:${t} ${tail}` })),
    ...cfg.keywords.map((k) => ({
      kind: "keyword" as const, term: k, q: `"${k.replace(/"/g, "")}" in:name,description,readme ${tail}`,
    })),
    ...extra.filter((t) => !cfg.topics.includes(t)).map((t) => ({ kind: "catalog" as const, term: t, q: `topic:${t} ${tail}` })),
  ];
}

export async function searchSource(gh: GitHub, cfg: Config, pool: Pool, now: number, extra: string[] = []): Promise<number> {
  let found = 0;
  for (const { kind, term, q } of searchQueries(cfg, now, extra)) {
    const path = `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${cfg.limits.search_per_query}`;
    const res = await gh.get<{ items: any[] }>(path);
    for (const raw of (res?.items ?? []).slice(0, cfg.limits.search_per_query)) {
      const repo = toRepo(raw);
      if (!repo) continue;
      const c = pool.add(repo, "search");
      if (!c) continue;
      noteVia(c, kind, term);
      found++;
    }
  }
  return found;
}
