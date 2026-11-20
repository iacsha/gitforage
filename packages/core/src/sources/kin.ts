// Kin of your stars: repos that share several of the terms that characterise your
// own stars and seeds (see profile.ts), found by searching for pairs of those terms.
//
// Why not "people who starred your seeds also starred...": GitHub no longer shows the
// stargazer lists of other people's repos (404 over REST, an empty list over GraphQL),
// and sampling contributors and fork owners instead mostly surfaced whatever was viral
// that week. Your own star list is public and says more about you.
//
// Cost: one search per term pair (limits.kin_queries). The term counts behind the
// profile are cached for 30 days.

import type { Config } from "../config.ts";
import type { GitHub } from "../github.ts";
import { affinityOf, termPairs, type Profile } from "../profile.ts";
import { DAY_MS, isoDate, toRepo, type Repo } from "../types.ts";
import type { Pool } from "./pool.ts";

/** The stars of `stars_from`, newest first. */
export async function starsOf(gh: GitHub, user: string, maxPages: number): Promise<Repo[]> {
  const out: Repo[] = [];
  for (let p = 1; p <= maxPages; p++) {
    const page = await gh.get<any[]>(`/users/${user}/starred?per_page=100&page=${p}`, { allow: [404] });
    if (!page) break;
    for (const raw of page.slice(0, 100)) {
      const r = toRepo(raw);
      if (r) out.push(r);
    }
    if (page.length < 100) break;
  }
  return out;
}

/** One search per term pair: both terms, alive, within the star band. */
export function kinQueries(profile: Profile, cfg: Config, now: number): { label: string; q: string }[] {
  const L = cfg.limits;
  const stars = L.kin_max_stars > 0 ? `stars:${cfg.filters.min_stars}..${L.kin_max_stars}` : `stars:>=${cfg.filters.min_stars}`;
  const pushed = isoDate(now - L.kin_max_push_age_days * DAY_MS);
  return termPairs(profile, L.kin_queries).map(([a, b]) => ({
    label: `${a} + ${b}`,
    q: `"${a}" "${b}" ${stars} pushed:>=${pushed} fork:false archived:false`,
  }));
}

export async function kinSource(gh: GitHub, cfg: Config, pool: Pool, profile: Profile, now: number): Promise<number> {
  const L = cfg.limits;
  if (L.kin_queries === 0 || !profile.weights.size) return 0;
  let found = 0;
  for (const { label, q } of kinQueries(profile, cfg, now)) {
    const path = `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${L.search_per_query}`;
    const res = await gh.get<{ items: any[] }>(path, { allow: [422] });
    for (const raw of (res?.items ?? []).slice(0, L.search_per_query)) {
      const repo = toRepo(raw);
      if (!repo) continue;
      if (L.kin_max_stars > 0 && repo.stars > L.kin_max_stars) continue;
      const aff = affinityOf(repo, profile);
      if (aff.shared.length < Math.max(1, L.kin_min_overlap)) continue;
      const c = pool.add(repo, "kin");
      if (!c) continue;
      if (!c.kin) { c.kin = { queries: [] }; found++; }
      if (!c.kin.queries.includes(label)) c.kin.queries.push(label);
    }
  }
  return found;
}
