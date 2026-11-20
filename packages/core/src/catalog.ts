// The personalization catalog (site.personalize): every candidate the run found in any
// catalog topic, scored without the topic term, so a visitor's browser can add its own
// topic term for the topics they pick and re-rank.
//
// `run` (discover mode) saves it to state/catalog.json; `site` validates it again, as if
// a stranger had written it, and emits catalog.json for the portal. The size is kept
// down three ways: only the best `per_topic` candidates of each topic are kept, text is
// capped, and the whole file has a byte budget (the per-topic cap is lowered until it fits).

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Config } from "./config.ts";
import { isLanguageCode } from "./language.ts";
import { cleanText, isSafeFullName } from "./sanitize.ts";
import { daysSince, type Candidate, type Scored, type SourceName } from "./types.ts";

export interface CatalogReason { rule: string; points: number; text: string }

export interface CatalogItem {
  full_name: string;
  description: string;
  /** Catalog topics only (the ones a visitor can pick). */
  topics: string[];
  language: string | null;
  stars: number;
  /** Stars a month: stars / age for young repos, measured growth for older ones (0 when unknown). */
  velocity: number;
  created_at: string;
  pushed_at: string;
  sources: SourceName[];
  /** The score without topic_match. The browser adds topic_match for the visitor's topics. */
  base: number;
  /** Points from star_velocity and star_growth, for the "rising" sort. */
  rising: number;
  /** The top positive reasons other than topic_match. */
  reasons: CatalogReason[];
  /** Spoken language of the description (language.ts), "und" when unknown. */
  lang: string;
}

export interface CatalogState {
  version: 1;
  generated_at: string;
  items: CatalogItem[];
}

/** Hard caps, applied when the catalog is made and again when it is read. */
export const MAX_CATALOG_ITEMS = 2500;
/** Raw JSON budget for the items. About 1.6 MB gzips to well under 400 KB. */
export const MAX_CATALOG_BYTES = 1_600_000;
/** State files larger than this are refused. */
export const MAX_CATALOG_FILE_BYTES = 4 * 1024 * 1024;
export const CATALOG_DESCRIPTION_MAX = 200;
export const CATALOG_REASON_MAX = 120;
export const CATALOG_REASONS = 4;
export const CATALOG_ITEM_TOPICS = 12;

const SOURCES: SourceName[] = ["search", "rising", "fork", "kin"];
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const RULE_RE = /^[a-z_]{1,40}$/;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The catalog topics, or none when personalization is off. */
export function catalogTopics(cfg: Config): string[] {
  return cfg.site.personalize.enabled ? cfg.site.personalize.topics : [];
}

/** The config with the catalog topics as its topics: used to score the catalog. */
export function catalogConfig(cfg: Config): Config {
  const topics = [...new Set([...cfg.topics, ...catalogTopics(cfg)])];
  return { ...cfg, topics };
}

/**
 * Whether a candidate belongs to the default digest: found by a config topic or
 * keyword, or by the fork or kin source. Candidates found only by catalog searches
 * are left to the catalog, so turning personalization on does not change the default view.
 */
export function isDefaultCandidate(c: Candidate): boolean {
  return c.via_topics.length > 0 || c.via_keywords.length > 0 || c.sources.some((s) => s === "fork" || s === "kin");
}

const finite = (v: unknown, min = -1e9, max = 1e12): number | null => {
  const n = typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};
const iso = (v: unknown): string => (typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : "");

/** Catalog items from scored candidates (scored with catalogConfig). Items with no catalog topic are left out. */
export function toCatalogItems(scored: Scored[], cfg: Config, now: number): CatalogItem[] {
  const allowed = new Set(catalogTopics(cfg));
  const out: CatalogItem[] = [];
  for (const s of scored) {
    const c = s.candidate, r = c.repo;
    if (!isSafeFullName(r.full_name)) continue;
    const topics = [...new Set([...r.topics, ...c.via_topics, ...(c.via_catalog ?? [])])].filter((t) => allowed.has(t)).slice(0, CATALOG_ITEM_TOPICS);
    if (!topics.length) continue;
    const topicPoints = s.reasons.filter((x) => x.rule === "topic_match").reduce((n, x) => n + x.points, 0);
    const age = daysSince(r.created_at, now);
    const velocity = age <= cfg.filters.max_age_days ? (r.stars / Math.max(age, 7)) * 30 : c.growth?.per_month ?? 0;
    out.push({
      full_name: r.full_name,
      description: cleanText(r.description, CATALOG_DESCRIPTION_MAX),
      topics,
      language: r.language ? cleanText(r.language, 40) : null,
      stars: r.stars,
      velocity: Math.max(0, Math.round(velocity)),
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      sources: SOURCES.filter((x) => c.sources.includes(x)),
      base: r1(s.score - topicPoints),
      rising: r1(s.reasons.filter((x) => x.rule === "star_velocity" || x.rule === "star_growth").reduce((n, x) => n + x.points, 0)),
      reasons: s.reasons.filter((x) => x.rule !== "topic_match" && x.points > 0 && x.text)
        .slice(0, CATALOG_REASONS).map((x) => ({ rule: x.rule, points: x.points, text: cleanText(x.text, CATALOG_REASON_MAX) })),
      lang: c.spoken?.lang && isLanguageCode(c.spoken.lang) ? c.spoken.lang : "und",
    });
  }
  return out;
}

/** Validate one item read from disk. Returns the cleaned item or a problem. */
export function toCatalogItem(v: unknown, allowed?: Set<string>): CatalogItem | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "not an object";
  const o = v as Record<string, any>;
  const full_name = typeof o.full_name === "string" ? o.full_name : "";
  if (!isSafeFullName(full_name)) return "full_name must be owner/repo";
  const stars = finite(o.stars, 0, 1e9), base = finite(o.base), velocity = finite(o.velocity, 0, 1e9), rising = finite(o.rising ?? 0);
  if (stars === null || base === null || velocity === null || rising === null) return `${full_name}: stars, base, velocity and rising must be numbers`;
  const topics = Array.isArray(o.topics)
    ? [...new Set(o.topics.filter((t: unknown): t is string => typeof t === "string" && TOPIC_RE.test(t) && (!allowed || allowed.has(t))))].slice(0, CATALOG_ITEM_TOPICS)
    : [];
  if (!topics.length) return `${full_name}: no catalog topics`;
  const reasons: CatalogReason[] = Array.isArray(o.reasons)
    ? o.reasons.slice(0, CATALOG_REASONS).flatMap((x: any) => {
      const points = finite(x?.points);
      const rule = typeof x?.rule === "string" ? x.rule : "";
      return RULE_RE.test(rule) && rule !== "topic_match" && points !== null ? [{ rule, points, text: cleanText(x.text, CATALOG_REASON_MAX) }] : [];
    })
    : [];
  return {
    full_name,
    description: cleanText(o.description ?? "", CATALOG_DESCRIPTION_MAX),
    topics,
    language: typeof o.language === "string" && o.language ? cleanText(o.language, 40) : null,
    stars: Math.floor(stars),
    velocity: Math.round(velocity),
    created_at: iso(o.created_at),
    pushed_at: iso(o.pushed_at),
    sources: Array.isArray(o.sources) ? SOURCES.filter((s) => o.sources.includes(s)) : [],
    base: r1(base),
    rising: r1(rising),
    reasons,
    lang: isLanguageCode(o.lang) ? o.lang : "und",
  };
}

const itemsBytes = (items: CatalogItem[]) => Buffer.byteLength(JSON.stringify(items));

/**
 * Keep the best `perTopic` items of each topic (by base score, then stars, then name),
 * in that order, at most MAX_CATALOG_ITEMS. When the result is over the byte budget,
 * the per-topic cap is lowered until it fits; `per_topic` in the result says what was used.
 */
export function selectCatalog(items: CatalogItem[], topics: string[], perTopic: number, maxBytes = MAX_CATALOG_BYTES): { items: CatalogItem[]; per_topic: number } {
  const order = [...items].sort((a, b) => b.base - a.base || b.stars - a.stars || a.full_name.localeCompare(b.full_name));
  const pick = (n: number) => {
    const keep = new Set<CatalogItem>();
    for (const t of topics) {
      let k = 0;
      for (const it of order) {
        if (k >= n) break;
        if (it.topics.includes(t)) { keep.add(it); k++; }
      }
    }
    return order.filter((it) => keep.has(it)).slice(0, MAX_CATALOG_ITEMS);
  };
  let n = Math.max(1, perTopic);
  let out = pick(n);
  while (n > 1 && itemsBytes(out) > maxBytes) {
    n = Math.max(1, Math.floor(n * 0.8));
    out = pick(n);
  }
  while (out.length && itemsBytes(out) > maxBytes) out = out.slice(0, Math.floor(out.length * 0.9));
  return { items: out, per_topic: n };
}

/** Parse state/catalog.json. Bad items are dropped and reported; the file never throws. */
export function parseCatalogState(text: string, allowed?: Set<string>): { catalog: CatalogState | null; problems: string[] } {
  if (text.length > MAX_CATALOG_FILE_BYTES) return { catalog: null, problems: ["catalog.json is larger than 4 MB, ignored"] };
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { catalog: null, problems: ["catalog.json is not valid JSON, ignored"] };
  }
  if (data?.version !== 1 || !Array.isArray(data.items)) return { catalog: null, problems: ["catalog.json: expected version 1 and an items list"] };
  const problems: string[] = [];
  const items: CatalogItem[] = [];
  const seen = new Set<string>();
  data.items.slice(0, MAX_CATALOG_ITEMS).forEach((v: unknown, i: number) => {
    const r = toCatalogItem(v, allowed);
    if (typeof r === "string") { problems.push(`catalog.json items[${i}]: ${r}`); return; }
    const k = r.full_name.toLowerCase();
    if (!seen.has(k)) { seen.add(k); items.push(r); }
  });
  return { catalog: { version: 1, generated_at: iso(data.generated_at), items }, problems };
}

export function loadCatalog(path: string, allowed?: Set<string>): { catalog: CatalogState | null; problems: string[] } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { catalog: null, problems: [] };
    throw e;
  }
  return parseCatalogState(text, allowed);
}

/** Write state/catalog.json atomically. */
export function saveCatalog(path: string, c: CatalogState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(c) + "\n");
  renameSync(tmp, path);
}
