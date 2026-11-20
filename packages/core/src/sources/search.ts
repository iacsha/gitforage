// New and rising repos: one search per topic and per keyword, limited to repos created
// inside filters.max_age_days with at least filters.min_stars, sorted by stars.

import type { Config } from "../config.ts";
import type { GitHub } from "../github.ts";
import { DAY_MS, isoDate, toRepo } from "../types.ts";
import type { Pool } from "./pool.ts";

export function searchQueries(cfg: Config, now: number): { kind: "topic" | "keyword"; term: string; q: string }[] {
  const since = isoDate(now - cfg.filters.max_age_days * DAY_MS);
  const tail = `created:>=${since} stars:>=${cfg.filters.min_stars} archived:false`;
  return [
    ...cfg.topics.map((t) => ({ kind: "topic" as const, term: t, q: `topic:${t} ${tail}` })),
    ...cfg.keywords.map((k) => ({
      kind: "keyword" as const, term: k, q: `"${k.replace(/"/g, "")}" in:name,description,readme ${tail}`,
    })),
  ];
}

export async function searchSource(gh: GitHub, cfg: Config, pool: Pool, now: number): Promise<number> {
  let found = 0;
  for (const { kind, term, q } of searchQueries(cfg, now)) {
    const path = `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${cfg.limits.search_per_query}`;
    const res = await gh.get<{ items: any[] }>(path);
    for (const raw of (res?.items ?? []).slice(0, cfg.limits.search_per_query)) {
      const repo = toRepo(raw);
      if (!repo) continue;
      const c = pool.add(repo, "search");
      if (!c) continue;
      if (kind === "topic" && !c.via_topics.includes(term)) c.via_topics.push(term);
      if (kind === "keyword" && !c.via_keywords.includes(term)) c.via_keywords.push(term);
      found++;
    }
  }
  return found;
}
