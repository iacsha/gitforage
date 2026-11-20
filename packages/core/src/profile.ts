// Your interest profile, learned from your own stars (`stars_from`) and your seeds.
//
// Every repo in the profile is turned into a set of terms: its topics, plus words from
// its name and description (and, for seeds, its README). A term's weight says how
// characteristic it is of you:
//
//   p(t)     = share of your profile repos that carry t        (how common among your stars)
//   g(t)     = repos on GitHub matching t / GITHUB_REPOS       (how common on GitHub overall)
//   lift(t)  = p(t) / g(t)
//   w(t)     = p(t) * log10(lift(t)), scaled so the top term is 1
//
// This is TF-IDF in spirit: "docker" may be on many of your stars, but it is on
// millions of repos, so it weighs little; "hl7" on a handful of your stars weighs a lot.
// A candidate's affinity is the sum of the weights of the profile terms it carries.
//
// All text here is untrusted. Terms are reduced to [a-z0-9+#-] tokens before use, so
// they are safe to put in a quoted search query and are never rendered unescaped.

import type { GitHub } from "./github.ts";
import type { Repo } from "./types.ts";

/** Order-of-magnitude count of searchable public repos. It only sets the scale of lift. */
export const GITHUB_REPOS = 300_000_000;
/** A term must be on at least this many distinct profile repos to count. */
export const MIN_SUPPORT = 2;
/** How long topic and word counts from GitHub are cached: they change slowly. */
export const DF_TTL_MS = 30 * 86_400_000;
/** README text read per seed, after decoding. */
export const README_MAX_CHARS = 40_000;
/** A README word counts this much of its repo's weight. */
export const README_WEIGHT = 0.5;

// Common English and generic software words that say nothing about interests.
const STOP = new Set(`
a an and are as at be been but by can de for from has have how i if in into is it its la le
more my no not of on or our so that the their them then there these this to too up us use
used uses using was we what when which while who will with you your all any also just like
only over very via vs one two new get set out off make made way than other some such own
app apps application applications tool tools toolkit library libraries lib libs framework
frameworks simple easy fast lightweight light minimal small tiny powerful modern open source
opensource free based written built build builds project projects code repo repository
repositories github com www http https org net io html md readme docs doc documentation
example examples sample samples demo test tests testing support supports supported
version versions release releases feature features file files data system systems service
services platform platforms official unofficial client clients server servers api apis sdk
cli web site page user users run runs running work works working help helps manage
management managing create creates creating provide provides providing allow allows
plugin plugins extension extensions module modules package packages script scripts
implementation implemented written-in made-with yet another best great awesome list lists
curated collection collections resources resource guide guides tutorial tutorials
hacktoberfest good first issue issues help-wanted wip todo open-source opensource-software foss oss
license licensed licence mit apache gpl agpl bsd copyright install installation usage setup getting started across each every within without about after before between
`.split(/\s+/).filter(Boolean));

/**
 * Topics about events and labels rather than subject matter (hacktoberfest is on
 * thousands of unrelated repos). Kept out of the profile even though topics skip STOP.
 */
const META_TOPIC_RE = /^(hacktoberfest\d*|good-first-issues?|help-wanted|first-timers?-only|up-for-grabs|open-source|opensource|oss|foss|awesome|awesome-list)$/;
export const isMetaTopic = (t: string) => META_TOPIC_RE.test(t);

/** Lowercase [a-z0-9+#-] tokens of 2 to 40 characters, minus stopwords and bare numbers. */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9+#-]*/g) ?? []) {
    const t = raw.replace(/-+$/, "");
    if (t.length < 2 || t.length > 40 || /^[0-9-]+$/.test(t) || STOP.has(t)) continue;
    out.push(t);
  }
  return out;
}

/** The terms a repo carries: topics, plus words of its name and description, plus optional extra text. */
export function termsOf(r: Repo, extra = ""): Set<string> {
  const name = r.full_name.split("/")[1] ?? "";
  const set = new Set<string>();
  for (const t of r.topics) if (/^[a-z0-9][a-z0-9-]{0,49}$/.test(t) && !isMetaTopic(t)) set.add(t);
  for (const t of tokens(`${name.replace(/[-_.]+/g, " ")} ${r.description} ${extra}`)) set.add(t);
  return set;
}

export interface ProfileRepo { repo: Repo; readme?: string; /** Seeds count double. */ weight: number }

export interface ProfileCounts {
  /** Sum of repo weights. */
  size: number;
  /** term -> weighted count, for terms with enough support. */
  tf: Map<string, number>;
  /** "a\u0000b" (a < b) -> distinct repos carrying both. */
  cooc: Map<string, number>;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

export function profileCounts(repos: ProfileRepo[], maxTerms: number): ProfileCounts {
  const tf = new Map<string, number>();
  const support = new Map<string, number>();
  const sets: Set<string>[] = [];
  let size = 0;
  for (const { repo, readme, weight } of repos) {
    const set = termsOf(repo);
    sets.push(set);
    size += weight;
    for (const t of set) {
      tf.set(t, (tf.get(t) ?? 0) + weight);
      support.set(t, (support.get(t) ?? 0) + 1);
    }
    // README words are noisy ("started", "license"), so they add half weight and no
    // support: they can strengthen a term that topics or descriptions already show,
    // never introduce one.
    for (const t of new Set(tokens(readme ?? ""))) {
      if (!set.has(t)) tf.set(t, (tf.get(t) ?? 0) + weight * README_WEIGHT);
    }
  }
  const top = [...tf.entries()]
    .filter(([t]) => (support.get(t) ?? 0) >= MIN_SUPPORT)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTerms);
  const keep = new Map(top);
  const cooc = new Map<string, number>();
  for (const set of sets) {
    const mine = [...set].filter((t) => keep.has(t));
    for (let i = 0; i < mine.length; i++)
      for (let j = i + 1; j < mine.length; j++) {
        const k = pairKey(mine[i], mine[j]);
        cooc.set(k, (cooc.get(k) ?? 0) + 1);
      }
  }
  return { size, tf: keep, cooc };
}

export interface ProfileTerm { term: string; tf: number; df: number; lift: number; weight: number }

export interface Profile {
  size: number;
  /** Sorted by weight, highest first. Only terms with positive weight. */
  terms: ProfileTerm[];
  /** term -> weight (0..1]. */
  weights: Map<string, number>;
  cooc: Map<string, number>;
}

export const emptyProfile = (): Profile => ({ size: 0, terms: [], weights: new Map(), cooc: new Map() });

/** Weights from counts and GitHub-wide frequencies (`df`: term -> matching repo count). */
export function profileFrom(counts: ProfileCounts, df: Map<string, number>): Profile {
  const raw: ProfileTerm[] = [];
  if (counts.size <= 0) return emptyProfile();
  for (const [term, tf] of counts.tf) {
    const d = df.get(term);
    if (d === undefined) continue;
    const p = tf / counts.size;
    const lift = p / (Math.max(1, d) / GITHUB_REPOS);
    const w = lift > 1 ? p * Math.log10(lift) : 0;
    if (w > 0) raw.push({ term, tf, df: d, lift, weight: w });
  }
  const max = Math.max(0, ...raw.map((t) => t.weight));
  const terms = raw
    .map((t) => ({ ...t, weight: max > 0 ? t.weight / max : 0 }))
    .sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
  return { size: counts.size, terms, weights: new Map(terms.map((t) => [t.term, t.weight])), cooc: counts.cooc };
}

/** How many repos on GitHub match a term (bare search: name, description and topics). Null when unknown. */
export async function termFrequency(gh: GitHub, term: string): Promise<number | null> {
  if (!/^[a-z0-9][a-z0-9+#-]{0,49}$/.test(term)) return null;
  const q = encodeURIComponent(`"${term}"`);
  const res = await gh.get<{ total_count?: number }>(`/search/repositories?q=${q}&per_page=1`, { allow: [422], ttlMs: DF_TTL_MS });
  const n = Number(res?.total_count);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A seed's README as plain text, capped. Null when there is none. */
export async function readmeText(gh: GitHub, fullName: string): Promise<string | null> {
  const res = await gh.get<{ content?: string; encoding?: string }>(`/repos/${fullName}/readme`, { allow: [403, 404] });
  if (!res || res.encoding !== "base64" || typeof res.content !== "string") return null;
  const b64 = res.content.slice(0, Math.ceil((README_MAX_CHARS * 4) / 3) + 1024).replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return Buffer.from(b64, "base64").toString("utf8").slice(0, README_MAX_CHARS);
  } catch {
    return null;
  }
}

export interface Affinity { shared: string[]; fit: number }

/** Profile terms a repo carries, strongest first, and their summed weight (top 5). */
export function affinityOf(r: Repo, profile: Profile): Affinity {
  if (!profile.weights.size) return { shared: [], fit: 0 };
  const shared = [...termsOf(r)].filter((t) => profile.weights.has(t))
    .sort((a, b) => profile.weights.get(b)! - profile.weights.get(a)! || a.localeCompare(b));
  const fit = shared.slice(0, 5).reduce((s, t) => s + profile.weights.get(t)!, 0);
  return { shared, fit: Math.round(fit * 1000) / 1000 };
}

/**
 * Pairs of profile terms that occur together on your stars, best first. Each becomes
 * one kin search. A term joins at most `perTerm` pairs, so one big interest cannot
 * take every query, and pairs where one term contains the other ("tv", "android-tv")
 * are skipped as near-duplicates.
 */
export function termPairs(profile: Profile, n: number, perTerm = 3): [string, string][] {
  const scored: { a: string; b: string; s: number }[] = [];
  for (const [k, count] of profile.cooc) {
    if (count < MIN_SUPPORT) continue;
    const [a, b] = k.split("\u0000");
    const wa = profile.weights.get(a), wb = profile.weights.get(b);
    if (!wa || !wb || a.includes(b) || b.includes(a)) continue;
    scored.push({ a, b, s: count * Math.sqrt(wa * wb) });
  }
  scored.sort((x, y) => y.s - x.s || `${x.a} ${x.b}`.localeCompare(`${y.a} ${y.b}`));
  const used = new Map<string, number>();
  const out: [string, string][] = [];
  for (const { a, b } of scored) {
    if (out.length >= n) break;
    if ((used.get(a) ?? 0) >= perTerm || (used.get(b) ?? 0) >= perTerm) continue;
    used.set(a, (used.get(a) ?? 0) + 1);
    used.set(b, (used.get(b) ?? 0) + 1);
    out.push([a, b]);
  }
  return out;
}
