import type { GitHub } from "../github.ts";
import type { Candidate, Repo, SourceName } from "../types.ts";
import { toRepo } from "../types.ts";

/** Candidates keyed by full_name, so a repo found by several sources is one card. */
export class Pool {
  readonly items = new Map<string, Candidate>();
  /** Hard cap on distinct candidates, so a hostile or huge response cannot grow memory without bound. */
  static readonly MAX = 5000;

  /** Returns the candidate, or null when the pool is full and the repo is new. */
  add(repo: Repo, source: SourceName): Candidate | null {
    const key = repo.full_name.toLowerCase();
    let c = this.items.get(key);
    if (!c && this.items.size >= Pool.MAX) return null;
    if (!c) {
      c = { repo, sources: [], via_topics: [], via_keywords: [] };
      this.items.set(key, c);
    }
    if (!c.sources.includes(source)) c.sources.push(source);
    return c;
  }
}

/** Seed repo metadata, fetched once and shared by the fork and kin sources. */
export class SeedInfo {
  private cache = new Map<string, Promise<Repo | null>>();
  constructor(private gh: GitHub) {}

  get(full: string): Promise<Repo | null> {
    let p = this.cache.get(full);
    if (!p) {
      p = this.gh.get(`/repos/${full}`, { allow: [404, 451] }).then((r) => (r ? toRepo(r) : null));
      this.cache.set(full, p);
    }
    return p;
  }
}
