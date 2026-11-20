// feedback.yml: your Keep and Skip marks, and what they do to the ranking.
//
// Each mark records the repo and, as they were when you marked it, its topics and
// language. The latest mark per repo counts. Marks add up per topic, per owner and
// per language into a nudge between -1 and 1 (tanh of half the net count, so one
// mark moves things a little and three marks most of the way). The `feedback` rule
// then adds weight * (2 * topic nudge + owner nudge + language nudge) points, where
// the topic nudge is the mean over the repo's topics that have one. A repo you
// skipped is never shown again.
//
// The file may be written by an automated job from untrusted input (portal issues),
// so it is parsed strictly: safe YAML, a size cap, and every entry validated. Bad
// entries are dropped and reported, never guessed at.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseDocument, stringify } from "yaml";
import { cleanText, isSafeFullName } from "./sanitize.ts";
import type { Repo } from "./types.ts";

export type MarkKind = "keep" | "skip";
/** owner: you, or a collaborator on the portal repo. visitor: anyone else (portal Keep/Skip). */
export type MarkFrom = "owner" | "visitor";
export interface Mark {
  repo: string;
  mark: MarkKind;
  date: string;
  topics: string[];
  language: string | null;
  /** Missing means owner: marks you write by hand are yours. */
  from?: MarkFrom;
  /** The GitHub login that made the mark, for marks that came in through an issue. */
  by?: string;
}

export const MAX_FEEDBACK_BYTES = 1024 * 1024;
export const MAX_MARKS = 10_000;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export interface FeedbackFile { marks: Mark[]; problems: string[] }

/** Validate one entry; returns a Mark or a problem. */
export function toMark(v: unknown, where = "mark"): Mark | string {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return `${where}: must be a mapping`;
  const o = v as Record<string, unknown>;
  const unknown = Object.keys(o).filter((k) => !["repo", "mark", "date", "topics", "language", "from", "by"].includes(k));
  if (unknown.length) return `${where}: unknown key ${unknown[0]}`;
  const repo = String(o.repo ?? "");
  if (!isSafeFullName(repo)) return `${where}.repo: must be owner/repo`;
  const mark = String(o.mark ?? "");
  if (mark !== "keep" && mark !== "skip") return `${where}.mark: must be keep or skip`;
  const date = String(o.date ?? "");
  if (!DATE_RE.test(date) || !Number.isFinite(Date.parse(date))) return `${where}.date: must be YYYY-MM-DD`;
  const topics = o.topics === undefined || o.topics === null ? [] : o.topics;
  if (!Array.isArray(topics) || topics.length > 30 || !topics.every((t) => typeof t === "string" && TOPIC_RE.test(t))) {
    return `${where}.topics: must be a list of up to 30 GitHub topics`;
  }
  const lang = o.language === undefined || o.language === null || o.language === "" ? null : cleanText(o.language, 40);
  const out: Mark = { repo, mark, date, topics: topics as string[], language: lang };
  if (o.from !== undefined && o.from !== null) {
    if (o.from !== "owner" && o.from !== "visitor") return `${where}.from: must be owner or visitor`;
    out.from = o.from;
  }
  if (o.by !== undefined && o.by !== null) {
    if (typeof o.by !== "string" || !LOGIN_RE.test(o.by)) return `${where}.by: must be a GitHub login`;
    out.by = o.by;
  }
  return out;
}

export function parseFeedback(text: string, source = "feedback.yml"): FeedbackFile {
  if (text.length > MAX_FEEDBACK_BYTES) return { marks: [], problems: [`${source}: larger than 1 MB, ignored`] };
  const doc = parseDocument(text, { schema: "core", customTags: [], merge: false, uniqueKeys: true });
  if (doc.errors.length || doc.warnings.some((w) => /tag/i.test(w.message))) {
    return { marks: [], problems: [`${source}: not valid YAML, ignored`] };
  }
  let data: any;
  try {
    data = doc.toJS({ maxAliasCount: 0 });
  } catch {
    return { marks: [], problems: [`${source}: not valid YAML, ignored`] };
  }
  if (data === null || data === undefined) return { marks: [], problems: [] };
  if (typeof data !== "object" || data.version !== 1 || !Array.isArray(data.marks ?? [])) {
    return { marks: [], problems: [`${source}: expected version: 1 and a marks: list`] };
  }
  const marks: Mark[] = [];
  const problems: string[] = [];
  (data.marks ?? []).slice(0, MAX_MARKS).forEach((m: unknown, i: number) => {
    const r = toMark(m, `${source} marks[${i}]`);
    if (typeof r === "string") problems.push(r);
    else marks.push(r);
  });
  if ((data.marks ?? []).length > MAX_MARKS) problems.push(`${source}: only the first ${MAX_MARKS} marks are read`);
  return { marks, problems };
}

export function loadFeedback(path: string): FeedbackFile {
  try {
    return parseFeedback(readFileSync(path, "utf8"), path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { marks: [], problems: [] };
    throw e;
  }
}

const HEADER = "# gitforage feedback: Keep and Skip marks. The latest mark per repo counts.\n";

/** Append marks (validated again) and write atomically. Returns how many were added. */
export function appendFeedback(path: string, add: Mark[]): number {
  const cur = loadFeedback(path);
  // Rewriting would drop the bad entries, so a file with problems is left for a person to fix.
  if (cur.problems.length) throw new Error(`not changing ${path}: ${cur.problems[0]}`);
  const valid = add.map((m) => toMark(m)).filter((m): m is Mark => typeof m !== "string");
  const marks = [...cur.marks, ...valid];
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, HEADER + stringify({ version: 1, marks }, { lineWidth: 0, flowCollectionPadding: false }));
  renameSync(tmp, path);
  return valid.length;
}

export interface Nudges {
  topics: Map<string, number>;
  owners: Map<string, number>;
  languages: Map<string, number>;
  /** The latest mark per repo (lowercase key). */
  repos: Map<string, MarkKind>;
}

export const emptyNudges = (): Nudges => ({ topics: new Map(), owners: new Map(), languages: new Map(), repos: new Map() });

/** How much one visitor mark counts next to one of yours, unless the config says otherwise. */
export const DEFAULT_VISITOR_WEIGHT = 0.25;

/**
 * Your marks (from: owner, or no from) count 1 each, and the latest per repo decides
 * whether a repo is hidden. Visitor marks count visitorWeight each, latest per visitor
 * and repo, and only nudge: a visitor cannot hide a repo from your portal.
 * A visitorWeight of 0 ignores visitor marks.
 */
export function nudgesFrom(marks: Mark[], visitorWeight = DEFAULT_VISITOR_WEIGHT): Nudges {
  const latest = new Map<string, Mark>();
  for (const m of marks) {
    const visitor = m.from === "visitor";
    if (visitor && !(visitorWeight > 0)) continue;
    const k = visitor ? `v:${(m.by ?? "").toLowerCase()}:${m.repo.toLowerCase()}` : `o:${m.repo.toLowerCase()}`;
    const prev = latest.get(k);
    if (!prev || m.date >= prev.date) latest.set(k, m);
  }
  const net = { topics: new Map<string, number>(), owners: new Map<string, number>(), languages: new Map<string, number>() };
  const bump = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) ?? 0) + by);
  const n = emptyNudges();
  for (const [k, m] of latest) {
    if (k.startsWith("o:")) n.repos.set(k.slice(2), m.mark);
    const by = (m.mark === "keep" ? 1 : -1) * (m.from === "visitor" ? visitorWeight : 1);
    for (const t of new Set(m.topics)) bump(net.topics, t, by);
    bump(net.owners, m.repo.split("/")[0].toLowerCase(), by);
    if (m.language) bump(net.languages, m.language.toLowerCase(), by);
  }
  const squash = (src: Map<string, number>, dst: Map<string, number>) => {
    for (const [k, v] of src) if (v !== 0) dst.set(k, Math.round(Math.tanh(v / 2) * 1000) / 1000);
  };
  squash(net.topics, n.topics);
  squash(net.owners, n.owners);
  squash(net.languages, n.languages);
  return n;
}

export interface FeedbackNudge { topic: number; owner: number; language: number; hits: { kind: string; key: string; value: number }[] }

/** The nudges that apply to a repo, or null when none do. */
export function feedbackOf(r: Repo, n: Nudges): FeedbackNudge | null {
  const hits: FeedbackNudge["hits"] = [];
  const tv = r.topics.filter((t) => n.topics.has(t)).map((t) => {
    const value = n.topics.get(t)!;
    hits.push({ kind: "topic", key: t, value });
    return value;
  });
  const topic = tv.length ? tv.reduce((a, b) => a + b, 0) / tv.length : 0;
  const owner = n.owners.get(r.owner.toLowerCase()) ?? 0;
  if (owner) hits.push({ kind: "owner", key: r.owner, value: owner });
  const language = r.language ? n.languages.get(r.language.toLowerCase()) ?? 0 : 0;
  if (language) hits.push({ kind: "language", key: r.language!, value: language });
  if (!hits.length) return null;
  hits.sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.key.localeCompare(b.key));
  return { topic, owner, language, hits };
}
