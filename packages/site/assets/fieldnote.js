// gitforage portal: the field note on each specimen card.
//
// Deterministic sentences in the field-guide voice, built ONLY from structured,
// validated fields: a language name matching a strict pattern, topics on the
// portal's allow-list, the tree-ring numbers (age, recency, momentum), source names
// from a fixed list, and maintainer-health counts. The repo's description is never an
// input, and the repo name is only hashed to pick a template, never written out.
// Callers still escape the result (the server's html template, the browser's
// textContent).

import { FIELD_NOTE } from "./strings.js";

const LANG_RE = /^[A-Za-z0-9][A-Za-z0-9+#. -]{0,29}$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const SOURCE_ORDER = ["fork", "rising", "kin", "search"];

/** FNV-1a over the name: a stable, well-spread number per repo. @param {string} s */
export function noteHash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const count = (/** @type {unknown} */ v) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 1e9 ? Math.round(v) : null);
const fill = (/** @type {string} */ t, /** @type {Record<string, string>} */ vars) =>
  t.replace(/\{([A-Za-z]+)\}/g, (_m, k) => (Object.hasOwn(vars, k) ? vars[k] : ""));
const tidy = (/** @type {string} */ s) => s.replace(/\s+/g, " ").replace(/\s+([,.:])/g, "$1").trim();
const cap = (/** @type {string} */ s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * @param {{
 *   name: string, language?: unknown, topics?: unknown, allowed?: Iterable<string>,
 *   years?: unknown, growth?: unknown, sources?: unknown,
 *   health?: { outside_prs_90d?: unknown, issue_response?: { answered?: unknown, total?: unknown } | null } | null,
 * }} o
 * @returns {string}
 */
export function fieldNote(o) {
  const h = noteHash(String(o.name ?? ""));
  const allowed = new Set(o.allowed ?? []);
  const lang = typeof o.language === "string" && LANG_RE.test(o.language) ? o.language : "";
  const topics = Array.isArray(o.topics) ? o.topics.filter((t) => typeof t === "string" && TOPIC_RE.test(t) && allowed.has(t)) : [];
  const topic = topics.length ? topics[h % topics.length] : "";
  const yearsN = count(o.years);
  const years = yearsN === null ? 1 : Math.max(1, Math.min(5, yearsN));
  const growthN = count(o.growth);
  const growth = FIELD_NOTE.growth[growthN === null ? 0 : Math.min(3, growthN)];
  const age = FIELD_NOTE.age[years - 1];
  const vars = {
    age, Age: cap(age), growth,
    habitat: lang ? fill(FIELD_NOTE.habitat, { lang }) : "",
    where: topic ? fill(FIELD_NOTE.where, { topic }) : FIELD_NOTE.whereNone,
    rooted: lang ? fill(FIELD_NOTE.rooted, { lang }) : FIELD_NOTE.rootedNone,
  };
  const parts = [fill(FIELD_NOTE.openers[h % FIELD_NOTE.openers.length], vars)];
  const sources = Array.isArray(o.sources) ? o.sources : [];
  const src = /** @type {keyof typeof FIELD_NOTE.sources | undefined} */ (SOURCE_ORDER.find((s) => sources.includes(s)));
  if (src) {
    const set = FIELD_NOTE.sources[src];
    parts.push(fill(set[(h >>> 4) % set.length], vars));
  }
  const prs = count(o.health?.outside_prs_90d);
  if (prs) parts.push(fill(FIELD_NOTE.welcomes, { n: String(prs), prs: prs === 1 ? FIELD_NOTE.pr : FIELD_NOTE.prs }));
  const a = count(o.health?.issue_response?.answered), t = count(o.health?.issue_response?.total);
  if (a !== null && t && a <= t) parts.push(fill(FIELD_NOTE.answers, { a: String(a), t: String(t) }));
  return parts.map((p) => cap(tidy(p))).join(" ");
}
