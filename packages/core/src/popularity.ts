// Popularity within topic. Raw star counts favour whatever is big everywhere, so a
// candidate's popularity is its percentile among the candidates of this run that
// share an interest with it: within each of your topics and keywords (or, for kin,
// its strongest profile term). A 50-star HL7 repo at the top of the hl7 pool gets
// the same popularity points as a 5,000-star repo at the top of a generic one, and
// fit decides between them.
//
// Young repos (created within filters.max_age_days) are compared on stars per month,
// older ones on total stars, each against their own kind only.

import type { Config } from "./config.ts";
import { daysSince, type Candidate } from "./types.ts";

export type Basis = "velocity" | "stars";
export interface Popularity { basis: Basis; value: number; pct: number; group: string; n: number }

/** Group used when a candidate shares no interest with any group: the whole run. */
export const ALL = "*";

export function popularityValue(c: Candidate, cfg: Config, now: number): { basis: Basis; value: number } {
  const age = daysSince(c.repo.created_at, now);
  if (age <= cfg.filters.max_age_days) return { basis: "velocity", value: (c.repo.stars / Math.max(age, 7)) * 30 };
  return { basis: "stars", value: c.repo.stars };
}

/** The interests a candidate is compared within. */
export function groupsOf(c: Candidate, cfg: Config): string[] {
  const g = new Set<string>();
  const mine = new Set(cfg.topics);
  for (const t of c.repo.topics) if (mine.has(t)) g.add(t);
  for (const t of c.via_topics) g.add(t);
  const hay = `${c.repo.full_name} ${c.repo.description}`.toLowerCase();
  for (const k of cfg.keywords) if (hay.includes(k.toLowerCase())) g.add(k);
  for (const k of c.via_keywords) g.add(k);
  if (!g.size && c.affinity?.shared.length) g.add(c.affinity.shared[0]);
  return g.size ? [...g] : [ALL];
}

/** Mid-rank percentile of each value in a list: (below + equal / 2) / n, in [0, 1). */
export function midRanks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let below = 0, equal = 0;
    for (const x of sorted) { if (x < v) below++; else if (x === v) equal++; else break; }
    return (below + equal / 2) / values.length;
  });
}

/** Sets `popularity` on every candidate: its best percentile across its groups. */
export function assignPopularity(cands: Candidate[], cfg: Config, now: number): void {
  const members = new Map<string, { c: Candidate; value: number }[]>();
  const info = new Map<Candidate, { basis: Basis; value: number; groups: string[] }>();
  for (const c of cands) {
    const v = popularityValue(c, cfg, now);
    const groups = groupsOf(c, cfg);
    info.set(c, { ...v, groups });
    for (const g of groups) {
      const key = `${v.basis}\u0000${g}`;
      if (!members.has(key)) members.set(key, []);
      members.get(key)!.push({ c, value: v.value });
    }
  }
  const pct = new Map<string, Map<Candidate, number>>();
  for (const [key, list] of members) {
    const ranks = midRanks(list.map((m) => m.value));
    pct.set(key, new Map(list.map((m, i) => [m.c, ranks[i]])));
  }
  for (const c of cands) {
    const { basis, value, groups } = info.get(c)!;
    let best: Popularity | null = null;
    for (const g of groups) {
      const key = `${basis}\u0000${g}`;
      const p = pct.get(key)!.get(c)!;
      if (!best || p > best.pct) best = { basis, value, pct: p, group: g, n: members.get(key)!.length };
    }
    c.popularity = best!;
  }
}
