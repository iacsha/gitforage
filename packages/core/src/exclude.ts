import type { Config } from "./config.ts";
import { detectLanguage, LANGUAGES } from "./language.ts";
import { starFarmText } from "./starfarm.ts";
import type { Candidate, Repo } from "./types.ts";

export type PatternField = "name" | "description" | "topics";
export const PATTERN_FIELDS: PatternField[] = ["name", "description", "topics"];

/**
 * One `exclude.patterns` entry, compiled. A keyword is a case-insensitive substring;
 * a regex is a case-insensitive JavaScript regular expression. `in` limits the fields
 * it is matched against (default: all three). Topics are matched one at a time.
 */
export interface ExcludePattern {
  kind: "keyword" | "regex";
  source: string;
  in: PatternField[];
  test: (s: string) => boolean;
}

/** Longest regex source accepted from the config. */
export const MAX_PATTERN_LENGTH = 200;

/**
 * Regexes are matched against untrusted repo text, so shapes that can backtrack
 * exponentially are refused: a quantified group that itself contains a quantifier,
 * such as (a+)+, (a*)*, (a|aa)+ or (\w+\s?){2,}. Inputs are also length-capped
 * (descriptions at 500 characters), which bounds the cost of anything that slips by.
 */
export function unsafeRegexReason(src: string): string | null {
  if (src.length > MAX_PATTERN_LENGTH) return `is longer than ${MAX_PATTERN_LENGTH} characters`;
  if (/\\[1-9]|\\k</.test(src)) return "uses a backreference";
  if (/\(\?<?[=!]/.test(src)) return "uses a lookaround";
  // A group containing a quantifier or alternation, followed by a quantifier.
  if (/\((?:[^()\\]|\\.)*(?:[+*}]|\|)(?:[^()\\]|\\.)*\)\s*(?:[+*]|\{\d+,\d*\})/.test(src)) {
    return "has a nested quantifier (for example (a+)+), which can be very slow";
  }
  return null;
}

export function compileKeyword(word: string, fields: PatternField[] = PATTERN_FIELDS): ExcludePattern {
  const needle = word.toLowerCase();
  return { kind: "keyword", source: word, in: fields, test: (s) => s.toLowerCase().includes(needle) };
}

/** Throws with a readable message when the regex is invalid or unsafe. */
export function compileRegex(src: string, fields: PatternField[] = PATTERN_FIELDS): ExcludePattern {
  const why = unsafeRegexReason(src);
  if (why) throw new Error(why);
  const re = new RegExp(src, "i"); // throws SyntaxError on a bad pattern
  return { kind: "regex", source: src, in: fields, test: (s) => re.test(s) };
}

/** The first pattern that matches the repo, with the field it matched in. */
export function matchPattern(r: Repo, patterns: ExcludePattern[]): { pattern: ExcludePattern; field: PatternField } | null {
  for (const p of patterns) {
    for (const field of p.in) {
      const hit = field === "topics" ? r.topics.some((t) => p.test(t))
        : p.test(field === "name" ? r.full_name : r.description);
      if (hit) return { pattern: p, field };
    }
  }
  return null;
}

/**
 * Why a candidate is dropped, or null to keep it. Hard rules, applied before scoring:
 * already known (a seed or one of your stars), archived or disabled, excluded owner,
 * topic, keyword or pattern, language filter, and min_stars (forks are exempt from
 * min_stars, since a live fork is interesting before anyone stars it).
 */
export function exclusionReason(c: Candidate, cfg: Config, known: Set<string>): string | null {
  const r = c.repo;
  if (known.has(r.full_name.toLowerCase())) return "already in your seeds or stars";
  if (r.archived) return "archived";
  if (r.disabled) return "disabled";
  if (cfg.exclude.owners.includes(r.owner.toLowerCase())) return `excluded owner ${r.owner}`;

  const topic = r.topics.find((t) => cfg.exclude.topics.includes(t.toLowerCase()));
  if (topic) return `excluded topic ${topic}`;

  const haystack = `${r.full_name} ${r.description}`.toLowerCase();
  const kw = cfg.exclude.keywords.find((k) => haystack.includes(k));
  if (kw) return `excluded keyword "${kw}"`;

  const hit = matchPattern(r, cfg.exclude.patterns);
  if (hit) return `excluded ${hit.pattern.kind} "${hit.pattern.source}" in ${hit.field}`;

  if (cfg.filters.languages.length && !cfg.filters.languages.includes((r.language ?? "").toLowerCase())) {
    return `language ${r.language ?? "unknown"} not in filters.languages`;
  }
  const lang = spokenReason(c, cfg);
  if (lang) return lang;
  if (cfg.filters.drop_suspected_star_farms && c.star_farm) return starFarmText(c, c.star_farm);
  const forkOnly = c.sources.length === 1 && c.sources[0] === "fork";
  if (!forkOnly && r.stars < cfg.filters.min_stars) return `under min_stars (${r.stars})`;
  return null;
}

/**
 * filters.spoken_languages: drop repos whose description is in another language.
 * Undetermined ("und", short or ambiguous text) passes unless filters.drop_undetected.
 */
export function spokenReason(c: Candidate, cfg: Config): string | null {
  const allow = cfg.filters.spoken_languages;
  if (!allow.length) return null;
  const g = c.spoken ?? detectLanguage(c.repo.description);
  if (g.lang === "und") return cfg.filters.drop_undetected ? "language of the description not detected (filters.drop_undetected)" : null;
  if (allow.includes(g.lang)) return null;
  return `written in ${LANGUAGES[g.lang] ?? g.lang} (${g.lang}), not in filters.spoken_languages`;
}
