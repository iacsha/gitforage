// The pipeline: sources -> exclusions -> rule scores -> signals for the top N -> rescore.

import type { Config } from "./config.ts";
import { exclusionReason } from "./exclude.ts";
import { GitHub, RateLimitError } from "./github.ts";
import { rank, scoreCandidate } from "./scoring.ts";
import { fetchSignals } from "./signals.ts";
import { forkSource } from "./sources/forks.ts";
import { kinSource, starsOf } from "./sources/kin.ts";
import { affinityOf, emptyProfile, profileCounts, profileFrom, readmeText, termFrequency, type Profile, type ProfileRepo, type ProfileTerm } from "./profile.ts";
import type { Repo } from "./types.ts";
import { Pool, SeedInfo } from "./sources/pool.ts";
import { searchSource } from "./sources/search.ts";
import { risingSource } from "./sources/rising.ts";
import { assignPopularity } from "./popularity.ts";
import { feedbackOf, nudgesFrom, type Mark } from "./feedback.ts";
import type { Candidate } from "./types.ts";
import { emptyStars, growthOf, recordStars, type StarsState } from "./observations.ts";
import type { Scored } from "./types.ts";
import { detectLanguage } from "./language.ts";
import { starFarmCheck, starFarmText } from "./starfarm.ts";
import { catalogConfig, catalogTopics, isDefaultCandidate } from "./catalog.ts";
import { emptyRevival, revivalSource, type RevivalItem, type RevivalState } from "./revival.ts";

/** Candidates with fewer stars are not worth a contributors call for the star-farm guard. */
const FARM_CHECK_MIN_STARS = 2000;

export interface ForageOptions {
  now?: number;
  /** Repos to leave out before signals are fetched (the seen state, for `run`). */
  skip?: Set<string>;
  log?: (msg: string) => void;
  /**
   * Star counts from earlier runs (state/stars.json). Used for growth, and updated in
   * place with what this run saw, so the caller can save it.
   */
  stars?: StarsState;
  /** Keep/Skip marks (feedback.yml). Skipped repos are dropped; the rest nudge the score. */
  feedback?: Mark[];
  /**
   * Also forage the catalog topics (site.personalize) and return every eligible
   * candidate scored for the catalog. The default digest is unchanged by it.
   */
  catalog?: boolean;
  /**
   * The revival radar's state (state/revival.json), read for recent checks and updated
   * in place. false skips the radar for this run even when revival.enabled is set.
   */
  revival?: RevivalState | false;
}

export interface ForageResult {
  ranked: Scored[];
  excluded: { full_name: string; reason: string }[];
  skipped_seen: number;
  /** Per-source failures. A failing source does not stop the others. */
  warnings: string[];
  found: Record<string, number>;
  /** The strongest terms of your profile (from stars_from and seeds). */
  profile: ProfileTerm[];
  /** With `catalog`: every eligible candidate (seen or not), scored with the catalog topics. */
  catalog: Scored[] | null;
  /** Revival radar: dormant upstreams in your topics and the live fork carrying each. Null when it did not run. */
  revival: RevivalItem[] | null;
}

/** Most seeds whose README is read for the profile. */
const README_SEEDS = 20;

/**
 * Learn the profile: your stars (weight 1) and your seeds with their READMEs (weight 2),
 * then look up how common each frequent term is on GitHub.
 */
export async function buildProfile(gh: GitHub, cfg: Config, stars: Repo[], seeds: SeedInfo): Promise<Profile> {
  if (cfg.limits.kin_terms === 0) return emptyProfile();
  const repos: ProfileRepo[] = stars.map((repo) => ({ repo, weight: 1 }));
  for (const s of cfg.seeds.slice(0, README_SEEDS)) {
    const repo = await seeds.get(s);
    if (repo) repos.push({ repo, readme: (await readmeText(gh, repo.full_name)) ?? "", weight: 2 });
  }
  const counts = profileCounts(repos, cfg.limits.kin_terms);
  const df = new Map<string, number>();
  for (const term of counts.tf.keys()) {
    const n = await termFrequency(gh, term);
    if (n !== null) df.set(term, n);
  }
  return profileFrom(counts, df);
}

export async function forage(cfg: Config, gh: GitHub, opts: ForageOptions = {}): Promise<ForageResult> {
  const now = opts.now ?? Date.now();
  const log = opts.log ?? (() => {});
  const pool = new Pool();
  const seeds = new SeedInfo(gh);
  const warnings: string[] = [];
  const found: Record<string, number> = { search: 0, rising: 0, fork: 0, kin: 0 };
  const observations = opts.stars ?? emptyStars();
  const observed: Repo[] = [];

  const step = async (name: string, fn: () => Promise<number>) => {
    try {
      found[name] = await fn();
      log(`${name}: ${found[name]} hits`);
    } catch (e) {
      const msg = `${name} source failed: ${(e as Error).message}`;
      warnings.push(msg);
      log(msg);
      if (e instanceof RateLimitError) throw e;
    }
  };

  const known = new Set(cfg.seeds.map((s) => s.toLowerCase()));
  let stars: Repo[] = [];
  if (cfg.stars_from) {
    try {
      stars = await starsOf(gh, cfg.stars_from, cfg.limits.stars_from_max_pages);
      for (const r of stars) known.add(r.full_name.toLowerCase());
      log(`stars_from ${cfg.stars_from}: ${stars.length} stars`);
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      warnings.push(`stars_from failed: ${(e as Error).message}`);
    }
  }

  let profile = emptyProfile();
  try {
    profile = await buildProfile(gh, cfg, stars, seeds);
    if (profile.terms.length) log(`profile: ${profile.terms.length} terms, strongest ${profile.terms.slice(0, 6).map((t) => t.term).join(", ")}`);
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    warnings.push(`profile failed: ${(e as Error).message}`);
  }

  const extra = opts.catalog ? catalogTopics(cfg) : [];
  await step("search", () => searchSource(gh, cfg, pool, now, extra));
  await step("rising", () => risingSource(gh, cfg, pool, observations, now, observed, extra));
  await step("fork", () => forkSource(gh, cfg, pool, seeds, now));
  await step("kin", () => kinSource(gh, cfg, pool, profile, now));
  let revival: RevivalItem[] | null = null;
  if (cfg.revival.enabled && opts.revival !== false) {
    const state = opts.revival ?? emptyRevival();
    await step("revival", async () => {
      const r = await revivalSource(gh, cfg, state, now);
      warnings.push(...r.warnings);
      log(`revival: ${r.examined} upstreams examined, ${r.reused} from state, ${r.calls} of ${r.budget} calls`);
      revival = r.items;
      return r.items.length;
    });
  }
  for (const c of pool.items.values()) {
    const a = affinityOf(c.repo, profile);
    if (a.fit > 0) c.affinity = a;
    const g = growthOf(c.repo, observations, now);
    if (g) c.growth = g;
    c.spoken = detectLanguage(c.repo.description);
    const farm = starFarmCheck(c, now);
    if (farm) c.star_farm = farm;
    observed.push(c.repo);
  }
  recordStars(observations, observed, now);

  const nudges = nudgesFrom(opts.feedback ?? [], cfg.feedback.visitors ? cfg.feedback.visitor_weight : 0);
  const excluded: ForageResult["excluded"] = [];
  const eligible: Candidate[] = [];
  for (const c of pool.items.values()) {
    const why = nudges.repos.get(c.repo.full_name.toLowerCase()) === "skip" ? "you skipped it" : exclusionReason(c, cfg, known);
    if (why) excluded.push({ full_name: c.repo.full_name, reason: why });
    else eligible.push(c);
  }
  // The default digest only weighs candidates found by the config's own queries (see
  // isDefaultCandidate), so the catalog searches do not change it.
  const base = extra.length ? eligible.filter(isDefaultCandidate) : eligible;
  if (extra.length) found.catalog = eligible.length - base.length;
  // Percentiles over everything eligible, seen or not, so they are stable from run to run.
  if (cfg.popularity === "topic") assignPopularity(base, cfg, now);
  let skipped_seen = 0;
  const kept: Scored[] = [];
  for (const c of base) {
    if (opts.skip?.has(c.repo.full_name.toLowerCase())) { skipped_seen++; continue; }
    const f = feedbackOf(c.repo, nudges);
    if (f) c.feedback = f;
    kept.push(scoreCandidate(c, cfg, now));
  }
  rank(kept);

  // Signals cost API calls, so only the current top N get them, then everything is re-ranked.
  const farmGuard = cfg.weights.star_farm !== 0 || cfg.filters.drop_suspected_star_farms;
  const top = kept.slice(0, cfg.limits.signals_top);
  for (const s of top) {
    const c = s.candidate;
    try {
      c.signals = await fetchSignals(gh, c.repo.full_name, cfg.weights, now, {
        contributors: farmGuard && c.repo.stars >= FARM_CHECK_MIN_STARS && !c.star_farm,
      });
      const farm = starFarmCheck(c, now);
      if (farm) c.star_farm = farm;
      Object.assign(s, scoreCandidate(c, cfg, now));
    } catch (e) {
      if (e instanceof RateLimitError) throw e;
      warnings.push(`signals for ${s.candidate.repo.full_name} failed: ${(e as Error).message}`);
    }
  }
  // The contributor count can reveal a star farm only now; drop those too when asked.
  if (cfg.filters.drop_suspected_star_farms) {
    for (let i = kept.length - 1; i >= 0; i--) {
      const c = kept[i].candidate;
      if (c.star_farm) { excluded.push({ full_name: c.repo.full_name, reason: starFarmText(c, c.star_farm) }); kept.splice(i, 1); }
    }
  }
  rank(kept);

  const catalog = opts.catalog ? scoreCatalog(eligible, cfg, nudges, now) : null;
  return { ranked: kept, excluded, skipped_seen, warnings, found, profile: profile.terms.slice(0, 30), catalog, revival };
}

/**
 * Score every eligible candidate (seen ones too) with the catalog topics, for the
 * browser to re-rank. Signals are only there for the digest's top N. Popularity is
 * recomputed within the catalog topics and then restored, so the digest's JSON keeps its own.
 */
function scoreCatalog(eligible: Candidate[], cfg: Config, nudges: ReturnType<typeof nudgesFrom>, now: number): Scored[] {
  const ucfg = catalogConfig(cfg);
  const list = eligible.filter((c) => !(cfg.filters.drop_suspected_star_farms && c.star_farm));
  const saved = new Map(list.map((c) => [c, c.popularity] as const));
  if (ucfg.popularity === "topic") assignPopularity(list, ucfg, now);
  const scored = rank(list.map((c) => {
    const f = feedbackOf(c.repo, nudges);
    if (f) c.feedback = f;
    return scoreCandidate(c, ucfg, now);
  }));
  for (const [c, p] of saved) {
    if (p) c.popularity = p;
    else delete c.popularity;
  }
  return scored;
}
