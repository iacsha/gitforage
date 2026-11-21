// state/digests/<date>-<mode>.json: what each `run` reported, kept for the portal.
//
// The portal (packages/site) and the feedback intake read these files back. They are
// written by gitforage, but they sit in a git repo and carry text from strangers'
// repos, so loading treats them as untrusted: every field is validated and cleaned
// again, bad items are dropped and reported, and sizes are capped.

import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Mode } from "./weights.ts";
import { MODES } from "./weights.ts";
import { toJson } from "./report.ts";
import { isLanguageCode } from "./language.ts";
import { cleanText, isSafeFullName, repoUrl } from "./sanitize.ts";
import type { Scored, SourceName } from "./types.ts";
import { cleanNote } from "./llm.ts";

export interface DigestItem {
  full_name: string;
  url: string;
  score: number;
  stars: number;
  language: string | null;
  description: string;
  sources: SourceName[];
  reasons: { rule: string; points: number; text: string }[];
  topics: string[];
  via_topics: string[];
  created_at: string;
  pushed_at: string;
  /** The natural language of the description (a code from language.ts), "und" when unknown. */
  lang: string;
  /** Maintainer health, when the run fetched it (contribute mode). */
  health: { outside_prs_90d: number | null; issue_response: { answered: number; total: number } | null } | null;
  /** The AI field note, when llm re-ranking ran and wrote one. */
  ai_note?: string;
}

export interface Digest {
  version: 1;
  date: string;
  mode: Mode;
  generated_at: string;
  items: DigestItem[];
}

export const DIGEST_FILE_RE = /^(\d{4}-\d{2}-\d{2})-(discover|contribute)\.json$/;
export const MAX_DIGEST_BYTES = 2 * 1024 * 1024;
export const MAX_DIGEST_ITEMS = 200;
/** Most digest files read (newest first): about five years of weekly runs in both modes. */
export const MAX_DIGESTS = 520;

const SOURCES: SourceName[] = ["search", "rising", "fork", "kin"];
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const RULE_RE = /^[a-z_]{1,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const finite = (v: unknown, min = -1e9, max = 1e12): number | null => {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const iso = (v: unknown): string => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : "");
const count = (v: unknown): number | null => {
  const n = finite(v, 0, 1e9);
  return n === null ? null : Math.floor(n);
};

/** The digest form of ranked items. */
export function toDigestItems(items: Scored[]): DigestItem[] {
  return toJson(items).map((j) => ({
    full_name: j.full_name,
    url: j.url,
    score: j.score,
    stars: j.stars,
    language: j.language,
    description: j.description,
    sources: j.sources,
    reasons: j.reasons,
    topics: j.topics,
    via_topics: j.via_topics,
    created_at: j.created_at,
    pushed_at: j.pushed_at,
    lang: j.lang,
    health: j.signals && (j.signals.outside_prs_90d !== undefined || j.signals.issue_response !== undefined)
      ? { outside_prs_90d: j.signals.outside_prs_90d ?? null, issue_response: j.signals.issue_response ?? null }
      : null,
    ...(j.ai_note ? { ai_note: j.ai_note } : {}),
  }));
}

/** Validate one item read from disk. Returns the cleaned item or a problem. */
export function toDigestItem(v: unknown): DigestItem | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "not an object";
  const o = v as Record<string, any>;
  const full_name = String(o.full_name ?? "");
  const url = repoUrl(full_name);
  if (!url || !isSafeFullName(full_name)) return "full_name must be owner/repo";
  const score = finite(o.score);
  const stars = count(o.stars);
  if (score === null || stars === null) return `${full_name}: score and stars must be numbers`;
  const sources = Array.isArray(o.sources) ? SOURCES.filter((s) => o.sources.includes(s)) : [];
  const reasons = Array.isArray(o.reasons)
    ? o.reasons.slice(0, 30).flatMap((r: any) => {
      const points = finite(r?.points);
      const rule = String(r?.rule ?? "");
      return RULE_RE.test(rule) && points !== null ? [{ rule, points, text: cleanText(r.text, 200) }] : [];
    })
    : [];
  const topicList = (t: unknown) => (Array.isArray(t) ? [...new Set(t.filter((x): x is string => typeof x === "string" && TOPIC_RE.test(x)))].slice(0, 30) : []);
  let health: DigestItem["health"] = null;
  if (o.health && typeof o.health === "object") {
    const ir = o.health.issue_response;
    const answered = count(ir?.answered), total = count(ir?.total);
    health = {
      outside_prs_90d: count(o.health.outside_prs_90d),
      issue_response: answered !== null && total !== null && answered <= total ? { answered, total } : null,
    };
  }
  return {
    full_name,
    url,
    score,
    stars,
    language: typeof o.language === "string" && o.language ? cleanText(o.language, 40) : null,
    description: cleanText(o.description ?? "", 500),
    sources,
    reasons,
    topics: topicList(o.topics),
    via_topics: topicList(o.via_topics),
    created_at: iso(o.created_at),
    pushed_at: iso(o.pushed_at),
    lang: isLanguageCode(o.lang) ? o.lang : "und",
    health,
    ...(typeof o.ai_note === "string" && cleanNote(o.ai_note) ? { ai_note: cleanNote(o.ai_note) } : {}),
  };
}

export interface LoadedDigests { digests: Digest[]; problems: string[] }

/** Parse one digest file's text. The date and mode come from the file name, not the body. */
export function parseDigest(text: string, file: string): { digest: Digest | null; problems: string[] } {
  const m = DIGEST_FILE_RE.exec(file);
  if (!m) return { digest: null, problems: [`${file}: not a digest file name`] };
  if (text.length > MAX_DIGEST_BYTES) return { digest: null, problems: [`${file}: larger than 2 MB, ignored`] };
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { digest: null, problems: [`${file}: not valid JSON, ignored`] };
  }
  if (data?.version !== 1 || !Array.isArray(data.items)) return { digest: null, problems: [`${file}: expected version 1 and an items list`] };
  const problems: string[] = [];
  const items: DigestItem[] = [];
  const seen = new Set<string>();
  data.items.slice(0, MAX_DIGEST_ITEMS).forEach((it: unknown, i: number) => {
    const r = toDigestItem(it);
    if (typeof r === "string") { problems.push(`${file} items[${i}]: ${r}`); return; }
    const k = r.full_name.toLowerCase();
    if (!seen.has(k)) { seen.add(k); items.push(r); }
  });
  const date = m[1];
  if (!Number.isFinite(Date.parse(date))) return { digest: null, problems: [`${file}: bad date`] };
  const generated_at = iso(data.generated_at) || `${date}T00:00:00.000Z`;
  return { digest: { version: 1, date, mode: m[2] as Mode, generated_at, items }, problems };
}

/** Read every digest in a directory, newest first (by date, then discover before contribute). */
export function loadDigests(dir: string): LoadedDigests {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { digests: [], problems: [] };
    throw e;
  }
  const files = names.filter((n) => DIGEST_FILE_RE.test(n)).sort(digestOrder).slice(0, MAX_DIGESTS);
  const digests: Digest[] = [];
  const problems: string[] = [];
  for (const f of files) {
    const p = join(dir, f);
    const st = statSync(p);
    if (!st.isFile()) continue;
    if (st.size > MAX_DIGEST_BYTES) { problems.push(`${f}: larger than 2 MB, ignored`); continue; }
    const r = parseDigest(readFileSync(p, "utf8"), f);
    problems.push(...r.problems);
    if (r.digest) digests.push(r.digest);
  }
  return { digests, problems };
}

/** Newest date first; on the same date discover comes before contribute. */
function digestOrder(a: string, b: string): number {
  const [, da, ma] = DIGEST_FILE_RE.exec(a)!;
  const [, db, mb] = DIGEST_FILE_RE.exec(b)!;
  return db.localeCompare(da) || MODES.indexOf(ma as Mode) - MODES.indexOf(mb as Mode);
}

export const digestFileName = (date: string, mode: Mode) => `${date}-${mode}.json`;

/**
 * Write a run's digest atomically. A second run on the same date and mode adds its
 * items after the first run's, so a manual rerun does not erase what was reported.
 */
export function saveDigest(dir: string, d: Digest): string {
  if (!DATE_RE.test(d.date) || !MODES.includes(d.mode)) throw new Error("bad digest date or mode");
  mkdirSync(dir, { recursive: true });
  const name = digestFileName(d.date, d.mode);
  const path = join(dir, name);
  let prev: Digest | null = null;
  try {
    prev = parseDigest(readFileSync(path, "utf8"), name).digest;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  if (prev) {
    const have = new Set(prev.items.map((i) => i.full_name.toLowerCase()));
    d = { ...d, items: [...prev.items, ...d.items.filter((i) => !have.has(i.full_name.toLowerCase()))].slice(0, MAX_DIGEST_ITEMS) };
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(d, null, 2) + "\n");
  renameSync(tmp, path);
  return path;
}
