// Live forks of seeds. List forks (newest, plus most-starred so long-running revivals
// are not missed), drop the ones that were never pushed after forking or have gone
// quiet, then compare the freshest few against upstream for ahead_by.

import type { Config } from "../config.ts";
import type { GitHub } from "../github.ts";
import { DAY_MS, toRepo, type Repo } from "../types.ts";
import type { Pool, SeedInfo } from "./pool.ts";

/** Cheap pre-filter: pushed after it was forked, recently enough, and not archived. */
export function isLiveFork(f: Repo, now: number, maxPushAgeDays: number): boolean {
  if (f.archived || f.disabled) return false;
  const created = Date.parse(f.created_at), pushed = Date.parse(f.pushed_at);
  if (!Number.isFinite(created) || !Number.isFinite(pushed)) return false;
  if (pushed - created < 60_000) return false; // never pushed since forking
  return now - pushed <= maxPushAgeDays * DAY_MS;
}

export async function forkSource(gh: GitHub, cfg: Config, pool: Pool, seeds: SeedInfo, now: number): Promise<number> {
  const L = cfg.limits;
  if (L.forks_per_seed === 0 || L.fork_compares_per_seed === 0) return 0;
  let found = 0;
  for (const seed of cfg.seeds) {
    const up = await seeds.get(seed);
    if (!up) continue;
    const listed = new Map<string, Repo>();
    for (const sort of ["newest", "stargazers"]) {
      const page = await gh.get<any[]>(`/repos/${up.full_name}/forks?sort=${sort}&per_page=${L.forks_per_seed}`, { allow: [404] });
      for (const raw of (page ?? []).slice(0, L.forks_per_seed)) {
        const f = toRepo(raw);
        if (f) listed.set(f.full_name, f);
      }
    }
    const live = [...listed.values()]
      .filter((f) => isLiveFork(f, now, L.fork_max_push_age_days))
      .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
      .slice(0, L.fork_compares_per_seed);

    for (const f of live) {
      const base = encodeURIComponent(up.default_branch);
      const head = `${encodeURIComponent(f.owner)}:${encodeURIComponent(f.default_branch)}`;
      // per_page=1 keeps the payload small; ahead_by/behind_by are totals regardless.
      const cmp = await gh.get<any>(`/repos/${up.full_name}/compare/${base}...${head}?per_page=1`, { allow: [404, 422] });
      const ahead = Number(cmp?.ahead_by ?? 0);
      if (ahead <= 0) continue;
      const c = pool.add(f, "fork");
      if (!c) continue;
      c.fork = { upstream: up.full_name, ahead_by: ahead, behind_by: Number(cmp?.behind_by ?? 0) };
      found++;
    }
  }
  return found;
}
