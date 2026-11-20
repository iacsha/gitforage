// interests.yml: load, validate, normalise.
//
// The schema follows ARCHITECTURE.md and the README reference. Three optional sections extend it for tuning:
// `weights` (override the scoring table), `limits` (API sampling caps) and `cache`.

import { readFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { compileKeyword, compileRegex, PATTERN_FIELDS, type ExcludePattern, type PatternField } from "./exclude.ts";
import { LANGUAGES } from "./language.ts";
import { isSafeFullName } from "./sanitize.ts";
import { MODES, PRESETS, weightsFor, type Mode, type Weights } from "./weights.ts";

export type Cadence = "daily" | "weekly" | "monthly";
export type LlmProvider = "none" | "anthropic" | "openai-compatible" | "ollama";

export interface Limits {
  /** Results per search request (max 100). */
  search_per_query: number;
  /** Forks listed per seed (newest first). */
  forks_per_seed: number;
  /** Compare calls per seed (the forks that survive the cheap filters). */
  fork_compares_per_seed: number;
  /** Forks not pushed within this many days are skipped before any compare. */
  fork_max_push_age_days: number;
  /** Profile terms (from your stars and seeds) whose GitHub-wide frequency is looked up. */
  kin_terms: number;
  /** Kin searches: one per pair of profile terms that occur together on your stars. */
  kin_queries: number;
  /** A kin repo must carry this many of your profile terms. */
  kin_min_overlap: number;
  /** Kin repos above this many stars are skipped: everyone already knows them. 0 = no cap. */
  kin_max_stars: number;
  /** Kin repos not pushed within this many days are not searched for. */
  kin_max_push_age_days: number;
  /** Results per rising-repo search (one per topic and keyword). 0 turns the rising source off. */
  rising_per_query: number;
  /** Rising repos need at least this many stars. */
  rising_min_stars: number;
  /** Rising repos must gain at least this many stars a month (and at least 1% of their stars). */
  rising_min_growth: number;
  /** Rising repos must have been pushed within this many days. */
  rising_push_days: number;
  /** Max pages (100 each) read from `stars_from`. */
  stars_from_max_pages: number;
  /** Activity signals (outside PRs, CONTRIBUTING, good first issue) are fetched for the top N only. */
  signals_top: number;
}

export interface Config {
  profile: string;
  topics: string[];
  keywords: string[];
  seeds: string[];
  stars_from: string | null;
  exclude: { topics: string[]; keywords: string[]; owners: string[]; patterns: ExcludePattern[] };
  filters: Filters;
  cadence: Cadence;
  digest_size: number;
  llm: { provider: LlmProvider; model: string };
  /** discover (default) or contribute: picks the weight preset. */
  mode: Mode;
  /** The weights in effect: the mode's preset plus weight_overrides. */
  weights: Weights;
  /** Only the keys the user set under `weights:`. */
  weight_overrides: Partial<Weights>;
  limits: Limits;
  cache: { ttl_hours: number };
  /** topic (default): stars and stars a month are scored as a percentile within each interest. global: raw counts, log-scaled. */
  popularity: "topic" | "global";
  site: SiteConfig;
  feedback: FeedbackConfig;
}

export interface Filters {
  min_stars: number;
  max_age_days: number;
  /** Programming languages (GitHub's language field). Empty means any. */
  languages: string[];
  /** Natural languages of the description (codes from language.ts). Empty means any. */
  spoken_languages: string[];
  /** With spoken_languages set, also drop repos whose language could not be told. */
  drop_undetected: boolean;
  /** Drop repos whose stars look inflated, instead of only lowering their score. */
  drop_suspected_star_farms: boolean;
}

export interface SiteConfig {
  /** The portal repo (owner/name) that Keep and Skip issues go to. In the Action, GITHUB_REPOSITORY fills it in. */
  repo: string | null;
  title: string;
  /** Public base URL of the portal, ending in /. Defaults to the GitHub Pages URL of repo. */
  url: string | null;
  /** Optional cookieless analytics. Off unless set. */
  analytics: { provider: "goatcounter"; code: string } | null;
}

export interface FeedbackConfig {
  /** Accept Keep and Skip issues from people who are not owners or collaborators of the portal repo. */
  visitors: boolean;
  /** How much a visitor mark counts next to one of yours (0 to 1). */
  visitor_weight: number;
  /** Most marks one GitHub user can add per run (and per UTC day). */
  max_per_user: number;
  /** Visitor accounts younger than this many days are ignored. */
  min_account_age_days: number;
}

export const DEFAULT_FEEDBACK: FeedbackConfig = { visitors: true, visitor_weight: 0.25, max_per_user: 3, min_account_age_days: 30 };
const GOATCOUNTER_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** A public https base URL with no credentials, query or fragment, normalised to end in /. */
export function normaliseBaseUrl(v: string): string | null {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port) return null;
  if (!/^[a-z0-9.-]+$/.test(u.hostname)) return null;
  const path = u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`;
  if (!/^[A-Za-z0-9._~\/-]*$/.test(path)) return null;
  return `https://${u.hostname}${path}`;
}

export const DEFAULT_LIMITS: Limits = {
  search_per_query: 30,
  forks_per_seed: 30,
  fork_compares_per_seed: 8,
  fork_max_push_age_days: 180,
  kin_terms: 30,
  kin_queries: 12,
  kin_min_overlap: 2,
  kin_max_stars: 20_000,
  kin_max_push_age_days: 180,
  rising_per_query: 30,
  rising_min_stars: 50,
  rising_min_growth: 10,
  rising_push_days: 30,
  stars_from_max_pages: 3,
  signals_top: 15,
};

export class ConfigError extends Error {
  constructor(public readonly source: string, public readonly problems: string[]) {
    super(`${source} is not valid:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

const TOP_KEYS = [
  "profile", "topics", "keywords", "seeds", "stars_from", "exclude", "filters",
  "cadence", "digest_size", "llm", "mode", "weights", "limits", "cache", "popularity", "site", "feedback",
];
const CADENCES: Cadence[] = ["daily", "weekly", "monthly"];
const PROVIDERS: LlmProvider[] = ["none", "anthropic", "openai-compatible", "ollama"];
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
/** A detectable language code other than "und" (see language.ts). */
const SPOKEN_RE = new RegExp(`^(?:${Object.keys(LANGUAGES).filter((l) => l !== "und").join("|")})$`);
const USER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Closest known key, for "did you mean" hints on typos. */
function suggest(key: string, known: string[]): string {
  let best = "", bestD = Infinity;
  for (const k of known) {
    const d = editDistance(key, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= 3 ? ` (did you mean "${best}"?)` : "";
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

class Checker {
  problems: string[] = [];
  err(path: string, msg: string) { this.problems.push(`${path}: ${msg}`); }

  unknownKeys(o: Obj, known: string[], path: string) {
    for (const k of Object.keys(o)) {
      if (!known.includes(k)) this.err(path ? `${path}.${k}` : k, `unknown key${suggest(k, known)}`);
    }
  }

  strList(v: unknown, path: string, opts: { re?: RegExp; hint?: string; lower?: boolean } = {}): string[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) { this.err(path, `must be a list, for example [a, b]`); return []; }
    const out: string[] = [];
    v.forEach((item, i) => {
      if (typeof item !== "string" || item.trim() === "") { this.err(`${path}[${i}]`, "must be a non-empty string"); return; }
      const s = opts.lower ? item.trim().toLowerCase() : item.trim();
      if (opts.re && !opts.re.test(s)) { this.err(`${path}[${i}]`, `"${item}" ${opts.hint ?? "is not valid"}`); return; }
      if (!out.includes(s)) out.push(s);
    });
    return out;
  }

  int(v: unknown, path: string, def: number, min: number, max: number): number {
    if (v === undefined || v === null) return def;
    if (typeof v !== "number" || !Number.isInteger(v)) { this.err(path, `must be a whole number`); return def; }
    if (v < min || v > max) { this.err(path, `must be between ${min} and ${max} (got ${v})`); return def; }
    return v;
  }

  num(v: unknown, path: string, def: number): number {
    if (v === undefined || v === null) return def;
    if (typeof v !== "number" || !Number.isFinite(v)) { this.err(path, `must be a number`); return def; }
    return v;
  }

  bool(v: unknown, path: string, def: boolean): boolean {
    if (v === undefined || v === null) return def;
    if (typeof v !== "boolean") { this.err(path, "must be true or false"); return def; }
    return v;
  }

  section(v: unknown, path: string): Obj {
    if (v === undefined || v === null) return {};
    if (!isObj(v)) { this.err(path, "must be a mapping (key: value lines)"); return {}; }
    return v;
  }
}

/** Most `exclude.patterns` entries accepted. */
export const MAX_PATTERNS = 200;

/**
 * `exclude.patterns`: each entry is a plain string (a keyword matched in name,
 * description and topics), or a mapping with exactly one of `keyword` or `regex`,
 * plus an optional `in: [name, description, topics]`.
 */
function excludePatterns(c: Checker, v: unknown): ExcludePattern[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) { c.err("exclude.patterns", "must be a list"); return []; }
  if (v.length > MAX_PATTERNS) { c.err("exclude.patterns", `at most ${MAX_PATTERNS} entries`); return []; }
  const out: ExcludePattern[] = [];
  v.forEach((item, i) => {
    const path = `exclude.patterns[${i}]`;
    if (typeof item === "string") {
      if (!item.trim()) c.err(path, "must be a non-empty string");
      else out.push(compileKeyword(item.trim()));
      return;
    }
    if (!isObj(item)) { c.err(path, "must be a keyword or a mapping with keyword: or regex:"); return; }
    c.unknownKeys(item, ["keyword", "regex", "in"], path);
    let fields: PatternField[] = PATTERN_FIELDS;
    if (item.in !== undefined && item.in !== null) {
      const list = c.strList(item.in, `${path}.in`, { lower: true });
      const bad = list.filter((f) => !PATTERN_FIELDS.includes(f as PatternField));
      if (bad.length) c.err(`${path}.in`, `must be some of ${PATTERN_FIELDS.join(", ")} (got ${bad.join(", ")})`);
      else if (list.length) fields = list as PatternField[];
    }
    const hasK = typeof item.keyword === "string" && item.keyword.trim() !== "";
    const hasR = typeof item.regex === "string" && item.regex !== "";
    if (hasK === hasR) { c.err(path, "needs exactly one of keyword: or regex: (non-empty text)"); return; }
    if (hasK) { out.push(compileKeyword((item.keyword as string).trim(), fields)); return; }
    try {
      out.push(compileRegex(item.regex as string, fields));
    } catch (e) {
      c.err(`${path}.regex`, `${(e as Error).message.split("\n")[0]}`);
    }
  });
  return out;
}

/** Validate an already-parsed object. Throws ConfigError listing every problem found. */
export function validateConfig(raw: unknown, source = "interests.yml"): Config {
  const c = new Checker();
  if (!isObj(raw)) throw new ConfigError(source, ["the file must be a YAML mapping (topics:, seeds:, ...)"]);
  c.unknownKeys(raw, TOP_KEYS, "");

  let profile = "";
  if (raw.profile !== undefined && raw.profile !== null) {
    if (typeof raw.profile !== "string") c.err("profile", "must be text");
    else profile = raw.profile.trim();
  }

  const topics = c.strList(raw.topics, "topics", {
    re: TOPIC_RE, lower: true, hint: "is not a GitHub topic (lowercase letters, digits and hyphens, max 50)",
  });
  const keywords = c.strList(raw.keywords, "keywords");
  const seeds = c.strList(raw.seeds, "seeds", { re: REPO_RE, hint: "must look like owner/repo" });
  seeds.forEach((s, i) => { if (!isSafeFullName(s)) c.err(`seeds[${i}]`, `"${s}" must look like owner/repo`); });

  let stars_from: string | null = null;
  if (raw.stars_from !== undefined && raw.stars_from !== null && raw.stars_from !== "") {
    if (typeof raw.stars_from !== "string" || !USER_RE.test(raw.stars_from)) c.err("stars_from", "must be a GitHub username");
    else stars_from = raw.stars_from;
  }

  if (topics.length === 0 && keywords.length === 0 && seeds.length === 0 && !stars_from) {
    c.problems.push("nothing to forage: add at least one of topics, keywords, seeds or stars_from");
  }

  const ex = c.section(raw.exclude, "exclude");
  c.unknownKeys(ex, ["topics", "keywords", "owners", "patterns"], "exclude");
  const exclude = {
    topics: c.strList(ex.topics, "exclude.topics", { lower: true }),
    keywords: c.strList(ex.keywords, "exclude.keywords").map((k) => k.toLowerCase()),
    owners: c.strList(ex.owners, "exclude.owners").map((o) => o.toLowerCase()),
    patterns: excludePatterns(c, ex.patterns),
  };

  const f = c.section(raw.filters, "filters");
  c.unknownKeys(f, ["min_stars", "max_age_days", "languages", "spoken_languages", "drop_undetected", "drop_suspected_star_farms"], "filters");
  const filters: Filters = {
    min_stars: c.int(f.min_stars, "filters.min_stars", 5, 0, 1_000_000),
    max_age_days: c.int(f.max_age_days, "filters.max_age_days", 365, 1, 3650),
    languages: c.strList(f.languages, "filters.languages").map((l) => l.toLowerCase()),
    spoken_languages: c.strList(f.spoken_languages, "filters.spoken_languages", {
      lower: true, re: SPOKEN_RE, hint: "is not a supported language code (use two-letter codes such as en, es, zh)",
    }),
    drop_undetected: c.bool(f.drop_undetected, "filters.drop_undetected", false),
    drop_suspected_star_farms: c.bool(f.drop_suspected_star_farms, "filters.drop_suspected_star_farms", false),
  };

  let cadence: Cadence = "weekly";
  if (raw.cadence !== undefined && raw.cadence !== null) {
    if (!CADENCES.includes(raw.cadence as Cadence)) c.err("cadence", `must be one of ${CADENCES.join(", ")}`);
    else cadence = raw.cadence as Cadence;
  }

  const digest_size = c.int(raw.digest_size, "digest_size", 20, 1, 200);

  const l = c.section(raw.llm, "llm");
  c.unknownKeys(l, ["provider", "model"], "llm");
  let provider: LlmProvider = "none";
  if (l.provider !== undefined && l.provider !== null) {
    if (!PROVIDERS.includes(l.provider as LlmProvider)) c.err("llm.provider", `must be one of ${PROVIDERS.join(", ")}`);
    else provider = l.provider as LlmProvider;
  }
  let model = "";
  if (l.model !== undefined && l.model !== null) {
    if (typeof l.model !== "string") c.err("llm.model", "must be text");
    else model = l.model;
  }

  let mode: Mode = "discover";
  if (raw.mode !== undefined && raw.mode !== null) {
    if (!MODES.includes(raw.mode as Mode)) c.err("mode", `must be one of ${MODES.join(", ")}`);
    else mode = raw.mode as Mode;
  }

  const w = c.section(raw.weights, "weights");
  const weightKeys = Object.keys(PRESETS.discover);
  c.unknownKeys(w, weightKeys, "weights");
  const weight_overrides: Partial<Weights> = {};
  for (const k of weightKeys) {
    if (w[k] !== undefined && w[k] !== null) (weight_overrides as Record<string, number>)[k] = c.num(w[k], `weights.${k}`, 0);
  }

  const lim = c.section(raw.limits, "limits");
  const limitKeys = Object.keys(DEFAULT_LIMITS);
  c.unknownKeys(lim, limitKeys, "limits");
  const limits = { ...DEFAULT_LIMITS };
  for (const k of limitKeys) {
    const max = k === "search_per_query" || k === "forks_per_seed" || k === "kin_terms" || k === "kin_queries" || k === "rising_per_query" ? 100 : 1000;
    (limits as Record<string, number>)[k] = c.int(lim[k], `limits.${k}`, DEFAULT_LIMITS[k as keyof Limits], 0, k === "kin_max_stars" || k === "rising_min_stars" ? 10_000_000 : max);
  }

  const ca = c.section(raw.cache, "cache");
  c.unknownKeys(ca, ["ttl_hours"], "cache");
  const ttl = c.num(ca.ttl_hours, "cache.ttl_hours", 12);
  if (ttl < 0) c.err("cache.ttl_hours", "must be 0 or more");

  let popularity: "topic" | "global" = "topic";
  if (raw.popularity !== undefined && raw.popularity !== null) {
    if (raw.popularity !== "topic" && raw.popularity !== "global") c.err("popularity", "must be topic or global");
    else popularity = raw.popularity;
  }

  const si = c.section(raw.site, "site");
  c.unknownKeys(si, ["repo", "title", "url", "analytics"], "site");
  const site: SiteConfig = { repo: null, title: "gitforage", url: null, analytics: null };
  if (si.repo !== undefined && si.repo !== null && si.repo !== "") {
    if (typeof si.repo !== "string" || !REPO_RE.test(si.repo) || !isSafeFullName(si.repo)) c.err("site.repo", "must look like owner/repo");
    else site.repo = si.repo;
  }
  if (si.title !== undefined && si.title !== null) {
    if (typeof si.title !== "string" || !si.title.trim()) c.err("site.title", "must be text");
    else if (si.title.length > 80) c.err("site.title", "at most 80 characters");
    else site.title = si.title.trim();
  }
  if (si.url !== undefined && si.url !== null && si.url !== "") {
    const u = typeof si.url === "string" ? normaliseBaseUrl(si.url) : null;
    if (!u) c.err("site.url", "must be a plain https:// URL (no credentials, port, query or #fragment)");
    else site.url = u;
  }
  if (si.analytics !== undefined && si.analytics !== null) {
    const an = c.section(si.analytics, "site.analytics");
    c.unknownKeys(an, ["provider", "code"], "site.analytics");
    if (an.provider !== "goatcounter") c.err("site.analytics.provider", "must be goatcounter (the only one supported)");
    else if (typeof an.code !== "string" || !GOATCOUNTER_CODE_RE.test(an.code)) c.err("site.analytics.code", "must be your GoatCounter code (lowercase letters, digits and hyphens)");
    else site.analytics = { provider: "goatcounter", code: an.code };
  }

  const fbk = c.section(raw.feedback, "feedback");
  c.unknownKeys(fbk, Object.keys(DEFAULT_FEEDBACK), "feedback");
  const feedback: FeedbackConfig = { ...DEFAULT_FEEDBACK };
  if (fbk.visitors !== undefined && fbk.visitors !== null) {
    if (typeof fbk.visitors !== "boolean") c.err("feedback.visitors", "must be true or false");
    else feedback.visitors = fbk.visitors;
  }
  feedback.visitor_weight = c.num(fbk.visitor_weight, "feedback.visitor_weight", DEFAULT_FEEDBACK.visitor_weight);
  if (feedback.visitor_weight < 0 || feedback.visitor_weight > 1) c.err("feedback.visitor_weight", "must be between 0 and 1");
  feedback.max_per_user = c.int(fbk.max_per_user, "feedback.max_per_user", DEFAULT_FEEDBACK.max_per_user, 1, 100);
  feedback.min_account_age_days = c.int(fbk.min_account_age_days, "feedback.min_account_age_days", DEFAULT_FEEDBACK.min_account_age_days, 0, 3650);

  if (c.problems.length) throw new ConfigError(source, c.problems);
  return {
    profile, topics, keywords, seeds, stars_from, exclude, filters, cadence, digest_size,
    llm: { provider, model }, mode, weights: weightsFor(mode, weight_overrides), weight_overrides, limits, cache: { ttl_hours: ttl }, popularity, site, feedback,
  };
}

/** The same config with another mode's preset (user overrides still apply). */
export function withMode(cfg: Config, mode: Mode): Config {
  return { ...cfg, mode, weights: weightsFor(mode, cfg.weight_overrides) };
}

/** Config files larger than this are refused. */
export const MAX_CONFIG_BYTES = 256 * 1024;

/**
 * Parse YAML text and validate it. Syntax errors carry line and column.
 * Safe parsing: the plain "core" schema (no custom or language-specific tags),
 * merge keys off, and few aliases allowed, so a crafted file cannot expand
 * without bound. The config is data only; nothing in it is executed or imported.
 */
export function parseConfig(text: string, source = "interests.yml"): Config {
  if (text.length > MAX_CONFIG_BYTES) throw new ConfigError(source, [`file is larger than ${MAX_CONFIG_BYTES / 1024} KB`]);
  const doc = parseDocument(text, { prettyErrors: true, schema: "core", customTags: [], merge: false, uniqueKeys: true });
  for (const w of doc.warnings) {
    if (/tag/i.test(w.message)) throw new ConfigError(source, [`YAML: ${w.message.split("\n")[0]}`]);
  }
  if (doc.errors.length) {
    throw new ConfigError(source, doc.errors.map((e) => `YAML syntax: ${e.message.split("\n")[0]}`));
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 20 });
  } catch (e) {
    throw new ConfigError(source, [`YAML: ${(e as Error).message.split("\n")[0]}`]);
  }
  return validateConfig(data, source);
}

export function loadConfig(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    throw new ConfigError(path, [`cannot read the file (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`]);
  }
  return parseConfig(text, path);
}
