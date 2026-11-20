import type { LanguageGuess } from "./language.ts";
import { cleanText, repoUrl } from "./sanitize.ts";
import type { StarFarmCheck } from "./starfarm.ts";

export type SourceName = "search" | "fork" | "kin" | "rising";

/** The repo fields gitforage uses, normalised from any GitHub repo payload. */
export interface Repo {
  full_name: string;
  owner: string;
  html_url: string;
  description: string;
  stars: number;
  language: string | null;
  topics: string[];
  license: string | null;
  created_at: string;
  pushed_at: string;
  archived: boolean;
  disabled: boolean;
  fork: boolean;
  default_branch: string;
  homepage: string;
  /** Counts used by the star-farm guard. Undefined when the payload did not carry them. */
  forks?: number;
  /** Open issues and pull requests, as GitHub counts them. */
  open_issues?: number;
  size_kb?: number;
}

export interface Candidate {
  repo: Repo;
  sources: SourceName[];
  /** Topics whose search returned this repo. */
  via_topics: string[];
  /** Keywords whose search returned this repo. */
  via_keywords: string[];
  /** Catalog topics (site.personalize) whose search returned this repo. Not part of the default digest. */
  via_catalog?: string[];
  fork?: { upstream: string; ahead_by: number; behind_by: number };
  /** Kin: the profile term pairs whose search found it. */
  kin?: { queries: string[] };
  /** Profile terms it carries (strongest first) and their summed weight. Set for every candidate when a profile exists. */
  affinity?: { shared: string[]; fit: number };
  signals?: Signals;
  /** Percentile of stars (or stars a month) among this run's candidates in the same interest. */
  popularity?: { basis: "velocity" | "stars"; value: number; pct: number; group: string; n: number };
  /** Keep/Skip nudges from feedback.yml that apply to this repo. */
  feedback?: { topic: number; owner: number; language: number; hits: { kind: string; key: string; value: number }[] };
  /** Star growth since an earlier run's observation (state/stars.json). */
  growth?: { delta: number; days: number; per_month: number };
  /** The natural language of the description (language.ts). */
  spoken?: LanguageGuess;
  /** Set when the stars look inflated for the repo's real activity (starfarm.ts). */
  star_farm?: StarFarmCheck;
}

/**
 * Signals fetched for the top candidates only. A field is undefined when it was not
 * fetched (its rules have weight 0 in this mode) and null when it could not be read.
 */
export interface Signals {
  outside_prs_90d?: number | null;
  contributing?: boolean | null;
  good_first_issues?: number | null;
  help_wanted?: number | null;
  readme?: boolean | null;
  latest_release?: { tag: string; published_at: string } | null;
  /** Recent issues (older than 2 days) that got a comment or were closed. */
  issue_response?: { answered: number; total: number } | null;
  /** Contributors listed by GitHub, counted up to 100. Fetched only for the star-farm guard. */
  contributors?: number | null;
}

export interface Reason {
  rule: string;
  points: number;
  text: string;
}

export interface Scored {
  candidate: Candidate;
  score: number;
  reasons: Reason[];
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);
/** A non-negative count, or undefined when the payload has none. */
const optCount = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
const isoOrEmpty = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : "");

/**
 * Normalise a GitHub repo payload. Returns null when the name is not a plain
 * owner/repo, so nothing downstream builds a path or link from a hostile name.
 * Text fields are cleaned of control and bidi characters and length-capped here;
 * renderers still escape them for their own format.
 */
export function toRepo(raw: any): Repo | null {
  const full_name = String(raw?.full_name ?? "");
  const html_url = repoUrl(full_name);
  if (!html_url) return null;
  const spdx = cleanText(raw.license?.spdx_id ?? "", 40);
  return {
    full_name,
    owner: full_name.split("/")[0],
    html_url,
    description: cleanText(raw.description ?? "", 500),
    stars: num(raw.stargazers_count),
    language: raw.language ? cleanText(raw.language, 40) : null,
    topics: Array.isArray(raw.topics) ? raw.topics.slice(0, 30).map((t: unknown) => cleanText(t, 50).toLowerCase()) : [],
    license: spdx && spdx !== "NOASSERTION" ? spdx : raw.license ? "other" : null,
    created_at: isoOrEmpty(raw.created_at),
    pushed_at: isoOrEmpty(raw.pushed_at ?? raw.updated_at),
    archived: Boolean(raw.archived),
    disabled: Boolean(raw.disabled),
    fork: Boolean(raw.fork),
    default_branch: cleanText(raw.default_branch ?? "main", 255) || "main",
    homepage: cleanText(raw.homepage ?? "", 300),
    ...defined({ forks: optCount(raw.forks_count), open_issues: optCount(raw.open_issues_count), size_kb: optCount(raw.size) }),
  };
}

function defined<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const DAY_MS = 86_400_000;
export const daysSince = (iso: string, now: number) =>
  iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS)) : Infinity;
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
