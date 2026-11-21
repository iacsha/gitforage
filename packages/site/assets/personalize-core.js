// gitforage portal: the pure logic behind "Pick your topics", shared by the browser
// (personalize.js imports it) and the tests (which import this same file). No DOM, no
// network, no storage: every function takes data and returns data.
//
// Everything that reaches these functions is untrusted: catalog.json (served by this
// site, but checked as if a stranger wrote it), the page URL, localStorage, the
// username field and GitHub's API responses. Each has a validator here that checks the
// shape, caps the size and the item count, and keeps only allow-listed values.

/** GitHub topics: lowercase letters, digits and hyphens. */
export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
/** GitHub logins. */
export const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
/** Starter pack ids. */
export const PACK_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_PART_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const RULE_RE = /^[a-z_]{1,40}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const LANG_RE = /^[a-z]{2,3}$/;
const LANGUAGE_RE = /^[A-Za-z0-9+#. '-]{1,40}$/;
const SOURCES = ["search", "rising", "fork", "kin"];
/** Control, bidi and zero-width characters: they can reorder or hide text. */
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁩﻿￾￿]/g;

/** Caps on everything read from outside. */
export const LIMITS = {
  catalogBytes: 4000000,
  items: 3000,
  topics: 200,
  groups: 32,
  packs: 32,
  itemTopics: 12,
  reasons: 4,
  selected: 40,
  search: 1024,
  param: 600,
  pickBytes: 4096,
  marks: 500,
  marksBytes: 65536,
  markTopics: 12,
  starsBytes: 8192,
  starsTopics: 50,
  starsDays: 30,
  starredPages: 3,
  starredPerPage: 100,
  starredBytes: 3000000,
  starredRepoTopics: 30,
  suggest: 8,
};

/**
 * @typedef {{ rule: string, points: number, text: string }} Reason
 * @typedef {{ full_name: string, description: string, topics: string[], language: string | null, stars: number,
 *   velocity: number, created_at: string, pushed_at: string, sources: string[], base: number, rising: number,
 *   reasons: Reason[], lang: string }} Item
 * @typedef {{ name: string, topics: string[] }} Group
 * @typedef {{ id: string, name: string, topics: string[] }} Pack
 * @typedef {{ version: 1, generated_at: string, portal: string | null, weights: { topic_match: number, feedback: number },
 *   topics: string[], groups: Group[], packs: Pack[], spoken: string[], drop_undetected: boolean, analytics: boolean,
 *   items: Item[] }} Catalog
 * @typedef {{ topics: string[], pack: string | null }} Selection
 * @typedef {{ mark: "keep" | "skip", topics: string[], language: string | null }} Mark
 * @typedef {Record<string, Mark>} Marks
 * @typedef {{ item: Item, score: number, hits: string[], reasons: Reason[] }} Ranked
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
/** @param {unknown} v @param {number} min @param {number} max */
const num = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);

/** Text from outside, made safe to show with textContent: one line, no control or bidi characters, capped. */
/** @param {unknown} v @param {number} [max] @returns {string} */
export function cleanText(v, max = 200) {
  if (typeof v !== "string") return "";
  const t = v.replace(/[\t\r\n]+/g, " ").replace(STRIP_RE, "").replace(/\s{2,}/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** owner/name, both halves plain GitHub name characters, never "." or "..". */
/** @param {unknown} v @returns {v is string} */
export function isFullName(v) {
  if (typeof v !== "string" || v.length > 201) return false;
  const parts = v.split("/");
  return parts.length === 2 && parts.every((p) => NAME_PART_RE.test(p) && p !== "." && p !== "..");
}

/** @param {unknown} v @returns {v is string} */
export const isLogin = (v) => typeof v === "string" && LOGIN_RE.test(v);
/** @param {unknown} v @returns {v is string} */
export const isTopic = (v) => typeof v === "string" && TOPIC_RE.test(v);

/** The only repo link: rebuilt from a validated name. */
/** @param {unknown} full @returns {string | null} */
export function repoUrl(full) {
  return isFullName(full) ? "https://github.com/" + full : null;
}

/** The Keep or Skip issue link on the portal repo, as the server builds it. */
/** @param {unknown} portal @param {string} kind @param {unknown} full @returns {string | null} */
export function feedbackUrl(portal, kind, full) {
  if (!isFullName(portal) || !isFullName(full) || (kind !== "keep" && kind !== "skip")) return null;
  return "https://github.com/" + portal + "/issues/new?template=gitforage-feedback.md&title=" +
    encodeURIComponent(kind + ": " + full) + "&labels=gitforage-feedback";
}

/** Links the client may set: GitHub repo pages and new-issue pages built from validated names. */
export const SAFE_HREF_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}(?:\/issues\/new\?[A-Za-z0-9%_.=&-]{1,400})?$/;

/** @param {unknown} list @param {(v: unknown) => boolean} ok @param {number} max @returns {string[]} */
function strings(list, ok, max) {
  if (!Array.isArray(list)) return [];
  /** @type {string[]} */
  const out = [];
  for (const v of list.slice(0, max * 4)) {
    if (out.length >= max) break;
    if (typeof v === "string" && ok(v) && out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

/** @param {unknown} v @param {Set<string>} allowed @returns {Item | null} */
export function parseItem(v, allowed) {
  if (!isObj(v) || !isFullName(v.full_name)) return null;
  const stars = num(v.stars, 0, 1e9), base = num(v.base, -1e6, 1e6), velocity = num(v.velocity, 0, 1e9), rising = num(v.rising, -1e6, 1e6);
  if (stars === null || base === null || velocity === null || rising === null) return null;
  const topics = strings(v.topics, (t) => TOPIC_RE.test(/** @type {string} */ (t)) && allowed.has(/** @type {string} */ (t)), LIMITS.itemTopics);
  if (!topics.length) return null;
  /** @type {Reason[]} */
  const reasons = [];
  if (Array.isArray(v.reasons)) {
    for (const r of v.reasons.slice(0, LIMITS.reasons)) {
      const points = isObj(r) ? num(r.points, -1e6, 1e6) : null;
      if (isObj(r) && points !== null && typeof r.rule === "string" && RULE_RE.test(r.rule) && r.rule !== "topic_match") {
        const text = cleanText(r.text, 120);
        if (text) reasons.push({ rule: r.rule, points, text });
      }
    }
  }
  return {
    full_name: v.full_name,
    description: cleanText(v.description, 200),
    topics,
    language: typeof v.language === "string" && LANGUAGE_RE.test(v.language) ? v.language : null,
    stars: Math.floor(stars),
    velocity: Math.round(velocity),
    created_at: typeof v.created_at === "string" && ISO_RE.test(v.created_at) ? v.created_at : "",
    pushed_at: typeof v.pushed_at === "string" && ISO_RE.test(v.pushed_at) ? v.pushed_at : "",
    sources: strings(v.sources, (s) => SOURCES.indexOf(/** @type {string} */ (s)) >= 0, 4),
    base,
    rising,
    reasons,
    lang: typeof v.lang === "string" && LANG_RE.test(v.lang) ? v.lang : "und",
  };
}

/**
 * Parse and check catalog.json. Returns null when the shape is wrong; bad items are
 * dropped one by one. Every topic anywhere must be in the catalog's own topic list.
 * @param {string} text @returns {Catalog | null}
 */
export function parseCatalog(text) {
  if (typeof text !== "string" || text.length > LIMITS.catalogBytes) return null;
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!isObj(data) || data.version !== 1 || !Array.isArray(data.items) || !Array.isArray(data.topics)) return null;
  const topics = strings(data.topics, isTopic, LIMITS.topics);
  const allowed = new Set(topics);
  /** @type {Group[]} */
  const groups = [];
  if (Array.isArray(data.groups)) {
    for (const g of data.groups.slice(0, LIMITS.groups)) {
      if (!isObj(g)) continue;
      const name = cleanText(g.name, 60);
      const list = strings(g.topics, (t) => allowed.has(/** @type {string} */ (t)), LIMITS.topics);
      if (name && list.length) groups.push({ name, topics: list });
    }
  }
  /** @type {Pack[]} */
  const packs = [];
  if (Array.isArray(data.packs)) {
    for (const p of data.packs.slice(0, LIMITS.packs)) {
      if (!isObj(p) || typeof p.id !== "string" || !PACK_RE.test(p.id) || packs.some((x) => x.id === p.id)) continue;
      const name = cleanText(p.name, 40);
      const list = strings(p.topics, (t) => allowed.has(/** @type {string} */ (t)), LIMITS.selected);
      if (name && list.length) packs.push({ id: p.id, name, topics: list });
    }
  }
  /** @type {Item[]} */
  const items = [];
  const seen = new Set();
  for (const v of data.items.slice(0, LIMITS.items)) {
    const it = parseItem(v, allowed);
    if (!it || seen.has(it.full_name.toLowerCase())) continue;
    seen.add(it.full_name.toLowerCase());
    items.push(it);
  }
  const w = isObj(data.weights) ? data.weights : {};
  return {
    version: 1,
    generated_at: typeof data.generated_at === "string" && ISO_RE.test(data.generated_at) ? data.generated_at : "",
    portal: isFullName(data.portal) ? data.portal : null,
    weights: { topic_match: num(w.topic_match, -100, 100) ?? 3, feedback: num(w.feedback, -100, 100) ?? 1 },
    topics,
    groups,
    packs,
    spoken: strings(data.spoken, (l) => LANG_RE.test(/** @type {string} */ (l)), 40),
    drop_undetected: data.drop_undetected === true,
    analytics: data.analytics === true,
    items,
  };
}

/**
 * A selection of topics (and optionally the pack it came from), checked against the
 * catalog's allow-lists. Unknown topics are dropped; a pack id must exist.
 * @param {unknown} topics @param {unknown} pack @param {Catalog} cat @returns {Selection}
 */
export function cleanSelection(topics, pack, cat) {
  const allowed = new Set(cat.topics);
  const list = strings(topics, (t) => allowed.has(/** @type {string} */ (t)), LIMITS.selected);
  const p = typeof pack === "string" && cat.packs.some((x) => x.id === pack) ? pack : null;
  return { topics: list, pack: p };
}

/**
 * The view asked for by the page URL: ?t=topic1,topic2 and/or ?pack=id. A pack
 * alone selects its topics. Returns null when the URL asks for nothing valid.
 * @param {string} search @param {Catalog} cat @returns {Selection | null}
 */
export function parseParams(search, cat) {
  if (typeof search !== "string" || !search || search.length > LIMITS.search) return null;
  /** @type {URLSearchParams} */
  let q;
  try {
    q = new URLSearchParams(search);
  } catch (e) {
    return null;
  }
  const t = q.get("t");
  const pack = q.get("pack");
  const raw = typeof t === "string" && t.length <= LIMITS.param ? t.split(",").map((s) => s.trim()) : [];
  const sel = cleanSelection(raw, pack, cat);
  if (!sel.topics.length && sel.pack) {
    const p = cat.packs.find((x) => x.id === sel.pack);
    if (p) sel.topics = p.topics.slice(0, LIMITS.selected);
  }
  return sel.topics.length ? sel : null;
}

/** The query string for a selection ("" for the default view). Topics and pack ids are plain slugs. */
/** @param {Selection | null} sel @returns {string} */
export function queryFor(sel) {
  if (!sel || !sel.topics.length) return "";
  return "?t=" + sel.topics.join(",") + (sel.pack ? "&pack=" + sel.pack : "");
}

/** @param {string | null} raw @param {number} max @returns {unknown} */
function json(raw, max) {
  if (typeof raw !== "string" || !raw || raw.length > max) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

/** The saved selection (localStorage "gitforage-picks"), or null when missing or malformed. */
/** @param {string | null} raw @param {Catalog} cat @returns {Selection | null} */
export function readPicks(raw, cat) {
  const d = json(raw, LIMITS.pickBytes);
  if (!isObj(d) || d.v !== 1) return null;
  const sel = cleanSelection(d.topics, d.pack, cat);
  return sel.topics.length ? sel : null;
}

/** @param {Selection} sel @returns {string} */
export function writePicks(sel) {
  return JSON.stringify({ v: 1, topics: sel.topics.slice(0, LIMITS.selected), pack: sel.pack });
}

/**
 * Local Keep/Skip marks (localStorage "gitforage-marks"): repo name to mark, with the
 * repo's catalog topics and language, which the nudges are keyed on.
 * @param {string | null} raw @returns {Marks}
 */
export function readMarks(raw) {
  /** @type {Marks} */
  const out = Object.create(null);
  const d = json(raw, LIMITS.marksBytes);
  if (!isObj(d) || d.v !== 1 || !isObj(d.marks)) return out;
  let n = 0;
  for (const k of Object.keys(d.marks)) {
    if (n >= LIMITS.marks) break;
    const m = d.marks[k];
    if (!isFullName(k) || !isObj(m) || (m.mark !== "keep" && m.mark !== "skip")) continue;
    out[k] = {
      mark: m.mark,
      topics: strings(m.topics, isTopic, LIMITS.markTopics),
      language: typeof m.language === "string" && LANGUAGE_RE.test(m.language) ? m.language : null,
    };
    n++;
  }
  return out;
}

/** @param {Marks} marks */
export function writeMarks(marks) {
  /** @type {Record<string, Mark>} */
  const o = {};
  for (const k of Object.keys(marks).slice(-LIMITS.marks)) o[k] = marks[k];
  return JSON.stringify({ v: 1, marks: o });
}

/** "YYYY-MM-DD" in UTC. */
/** @param {number} now @returns {string} */
export function today(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Topic weights derived from a stars lookup, cached with the date (localStorage
 * "gitforage-stars"). Nothing else about the visitor is stored: not the username, not
 * the starred repos. Entries older than LIMITS.starsDays are ignored.
 * @param {string | null} raw @param {Catalog} cat @param {number} now
 * @returns {{ date: string, weights: [string, number][] } | null}
 */
export function readStarsCache(raw, cat, now) {
  const d = json(raw, LIMITS.starsBytes);
  if (!isObj(d) || d.v !== 1 || typeof d.date !== "string" || !DAY_RE.test(d.date) || !Array.isArray(d.weights)) return null;
  const age = (now - Date.parse(d.date + "T00:00:00Z")) / 86400000;
  if (!Number.isFinite(age) || age < 0 || age > LIMITS.starsDays) return null;
  const allowed = new Set(cat.topics);
  /** @type {[string, number][]} */
  const weights = [];
  for (const e of d.weights.slice(0, LIMITS.starsTopics)) {
    if (!Array.isArray(e) || e.length !== 2) continue;
    const w = num(e[1], 0, 1e6);
    if (typeof e[0] === "string" && allowed.has(e[0]) && w !== null && !weights.some((x) => x[0] === e[0])) weights.push([e[0], w]);
  }
  return weights.length ? { date: d.date, weights } : null;
}

/** @param {[string, number][]} weights @param {number} now */
export function writeStarsCache(weights, now) {
  return JSON.stringify({ v: 1, date: today(now), weights: weights.slice(0, LIMITS.starsTopics).map((e) => [e[0], Math.round(e[1] * 1000) / 1000]) });
}

/** The API URL for one page of a user's stars. Null for anything that is not a login. */
/** @param {unknown} login @param {number} page @returns {string | null} */
export function starredUrl(login, page) {
  if (!isLogin(login) || !Number.isInteger(page) || page < 1 || page > LIMITS.starredPages) return null;
  return "https://api.github.com/users/" + encodeURIComponent(login) + "/starred?per_page=" + LIMITS.starredPerPage + "&page=" + page;
}

/**
 * Check one page of GitHub's starred list and keep only each repo's topics. The page
 * must be an array of at most 100 objects; everything but `topics` is ignored.
 * @param {unknown} data @returns {string[][] | null}
 */
export function starredTopics(data) {
  if (!Array.isArray(data) || data.length > LIMITS.starredPerPage) return null;
  /** @type {string[][]} */
  const out = [];
  for (const r of data) {
    if (!isObj(r)) return null;
    out.push(strings(r.topics, isTopic, LIMITS.starredRepoTopics));
  }
  return out;
}

/**
 * Topic weights from starred repos' topics, by lift against the catalog: p is the
 * share of the stars that carry a topic, b the share of catalog items that carry it,
 * and the weight is p * log2(1 + p / b). Only catalog topics count, and a topic needs
 * two stars behind it (one when there are fewer than 20 stars).
 * @param {string[][]} starred @param {Catalog} cat @returns {[string, number][]}
 */
export function topicWeights(starred, cat) {
  const n = starred.length;
  if (!n) return [];
  const allowed = new Set(cat.topics);
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const topics of starred) for (const t of new Set(topics)) if (allowed.has(t)) count.set(t, (count.get(t) || 0) + 1);
  /** @type {Map<string, number>} */
  const inCatalog = new Map();
  for (const it of cat.items) for (const t of it.topics) inCatalog.set(t, (inCatalog.get(t) || 0) + 1);
  const size = Math.max(1, cat.items.length);
  const min = n < 20 ? 1 : 2;
  /** @type {[string, number][]} */
  const out = [];
  for (const [t, k] of count) {
    if (k < min) continue;
    const p = k / n;
    const b = Math.max(1, inCatalog.get(t) || 0) / size;
    out.push([t, p * Math.log2(1 + p / b)]);
  }
  return out.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, LIMITS.starsTopics);
}

/** The topics to preselect from weights: the strongest few. */
/** @param {[string, number][]} weights @param {number} [n] @returns {string[]} */
export function suggestTopics(weights, n = LIMITS.suggest) {
  return weights.slice(0, n).map((e) => e[0]);
}

/** The topic reason, worded as the server words it. */
/** @param {string[]} hits @returns {string} */
export function topicReason(hits) {
  return hits.length === 1 ? "your topic " + hits[0] : hits.length + " of your topics (" + hits.slice(0, 4).join(", ") + ")";
}

/**
 * Nudges from local marks, the way feedback.yml nudges on the server: per topic, owner
 * and language, net keeps minus skips, through tanh(net / 2).
 * @param {Marks} marks
 */
export function nudges(marks) {
  /** @type {{ topic: Map<string, number>, owner: Map<string, number>, language: Map<string, number> }} */
  const net = { topic: new Map(), owner: new Map(), language: new Map() };
  for (const full of Object.keys(marks)) {
    const m = marks[full];
    const s = m.mark === "keep" ? 1 : -1;
    for (const t of m.topics) net.topic.set(t, (net.topic.get(t) || 0) + s);
    const owner = full.split("/")[0].toLowerCase();
    net.owner.set(owner, (net.owner.get(owner) || 0) + s);
    if (m.language) net.language.set(m.language.toLowerCase(), (net.language.get(m.language.toLowerCase()) || 0) + s);
  }
  for (const k of /** @type {const} */ (["topic", "owner", "language"])) for (const [key, v] of net[k]) net[k].set(key, Math.tanh(v / 2));
  return net;
}

/** @param {number} n */
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Re-rank the catalog for a selection: base score, plus topic_match per selected
 * topic the repo carries (up to 3), plus the local-mark nudge. Repos with none of the
 * selected topics, and repos skipped in this browser, are left out. Highest first;
 * ties by stars, then name.
 * @param {Item[]} items @param {string[]} selected @param {Marks} marks @param {{ topic_match: number, feedback: number }} weights
 * @returns {Ranked[]}
 */
export function rank(items, selected, marks, weights) {
  const want = new Set(selected);
  const nd = nudges(marks);
  /** @type {Ranked[]} */
  const out = [];
  for (const item of items) {
    const m = marks[item.full_name];
    if (m && m.mark === "skip") continue;
    const hits = item.topics.filter((t) => want.has(t));
    if (!hits.length) continue;
    const topicPoints = r1(weights.topic_match * Math.min(3, hits.length));
    /** @type {Reason[]} */
    const reasons = [{ rule: "topic_match", points: topicPoints, text: topicReason(hits) }];
    const tn = item.topics.filter((t) => nd.topic.has(t)).map((t) => /** @type {number} */ (nd.topic.get(t)));
    const topicNudge = tn.length ? tn.reduce((a, b) => a + b, 0) / tn.length : 0;
    const ownerNudge = nd.owner.get(item.full_name.split("/")[0].toLowerCase()) || 0;
    const langNudge = item.language ? nd.language.get(item.language.toLowerCase()) || 0 : 0;
    const fb = r1(weights.feedback * (2 * topicNudge + ownerNudge + langNudge));
    const local = Math.abs(fb) >= 0.05 ? fb : 0;
    if (local) reasons.push({ rule: "feedback", points: local, text: local > 0 ? "like repos you marked More like this" : "like repos you hid" });
    for (const r of item.reasons) reasons.push(r);
    reasons.sort((a, b) => b.points - a.points);
    const score = r1(item.base + topicPoints + local);
    out.push({ item, score, hits, reasons });
  }
  return out.sort((a, b) => b.score - a.score || b.item.stars - a.item.stars || (a.item.full_name < b.item.full_name ? -1 : a.item.full_name > b.item.full_name ? 1 : 0));
}

/** Whether a card matches the portal's language choice ("und" passes unless drop_undetected). */
/** @param {Catalog} cat @param {string} lang @returns {boolean} */
export function langMatches(cat, lang) {
  const langs = cat.spoken.length ? cat.spoken : ["en"];
  if (lang === "und") return !cat.drop_undetected;
  return langs.indexOf(lang) >= 0;
}

/** "Nov 20, 2026" from an ISO date, "" when unknown. */
/** @param {unknown} iso @returns {string} */
export function formatDate(iso) {
  if (typeof iso !== "string" || !ISO_RE.test(iso)) return "";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "";
}

/** A plain decimal for a data-* attribute, "0" for anything odd (the server's numAttr). */
/** @param {unknown} v @param {number} [digits] @returns {string} */
export function numAttr(v, digits = 0) {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  const s = Math.abs(n) >= 1e15 ? "0" : String(Number(n.toFixed(digits)));
  return /^-?\d+(\.\d+)?$/.test(s) ? s : "0";
}

/** "N repos for your topics: a, b and 3 more." */
/** @param {number} count @param {string[]} topics @returns {string} */
export function summaryText(count, topics) {
  const shown = topics.slice(0, 3).join(", ");
  const more = topics.length > 3 ? " and " + (topics.length - 3) + " more" : "";
  return count.toLocaleString("en-US") + (count === 1 ? " repo" : " repos") + " for your topics: " + shown + more + ".";
}

/** GoatCounter event names: fixed prefixes and allow-listed slugs only, never free text. */
/** @param {string} kind @param {unknown} value @returns {string | null} */
export function eventName(kind, value) {
  if (kind === "pack" && typeof value === "string" && PACK_RE.test(value)) return "pick-pack-" + value;
  if (kind === "topic" && isTopic(value)) return "pick-topic-" + value;
  if (kind === "stars" && value === "used") return "pick-stars-used";
  return null;
}

// ---- Carry your patch: export and import --------------------------------------------
//
// Until accounts exist, a visitor can carry their picks and local marks to another
// computer as a small JSON file. The file is untrusted when it comes back: it may have
// been edited, or written by someone else. parsePatchFile accepts only the exact shape
// writePatchFile makes, and rejects the whole file on anything else, so nothing is
// ever half applied.

/** The patch file's name, its kind marker and caps. */
export const PATCH_FILE = "gitforage-patch.json";
export const PATCH_KIND = "gitforage-patch";
export const PATCH_LIMITS = { bytes: 65536 };
const PATCH_KEYS = ["kind", "version", "exported", "topics", "pack", "marks"];
const MARK_KEYS = ["mark", "topics", "language"];

/** @param {Record<string, any>} o @param {string[]} keys @param {string[]} required */
function exactKeys(o, keys, required) {
  const have = Object.keys(o);
  return have.every((k) => keys.indexOf(k) >= 0) && required.every((k) => have.indexOf(k) >= 0);
}

/**
 * The patch file for a selection and the local marks.
 * @param {Selection} sel @param {Marks} marks @param {number} now @returns {string}
 */
export function writePatchFile(sel, marks, now) {
  /** @type {Record<string, Mark>} */
  const m = {};
  for (const k of Object.keys(marks).slice(-LIMITS.marks)) {
    const x = marks[k];
    m[k] = { mark: x.mark, topics: x.topics.slice(0, LIMITS.markTopics), language: x.language };
  }
  return JSON.stringify({ kind: PATCH_KIND, version: 1, exported: today(now), topics: sel.topics.slice(0, LIMITS.selected), pack: sel.pack, marks: m }, null, 2) + "\n";
}

/**
 * @typedef {{ ok: true, selection: Selection, marks: Marks } | { ok: false, error: "size" | "json" | "shape" | "version" | "topics" | "pack" | "marks" | "empty" }} PatchResult
 */

/**
 * Check an imported patch file against the catalog. Every topic must be a catalog
 * topic, the pack a catalog pack, every mark a plain owner/repo with the exact mark
 * shape. Any problem rejects the whole file.
 * @param {unknown} text @param {Catalog} cat @returns {PatchResult}
 */
export function parsePatchFile(text, cat) {
  if (typeof text !== "string" || text.length > PATCH_LIMITS.bytes) return { ok: false, error: "size" };
  /** @type {unknown} */
  let d;
  try {
    d = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: "json" };
  }
  if (!isObj(d) || !exactKeys(d, PATCH_KEYS, PATCH_KEYS) || d.kind !== PATCH_KIND) return { ok: false, error: "shape" };
  if (d.version !== 1) return { ok: false, error: "version" };
  if (typeof d.exported !== "string" || !DAY_RE.test(d.exported)) return { ok: false, error: "shape" };
  const allowed = new Set(cat.topics);
  if (!Array.isArray(d.topics) || d.topics.length > LIMITS.selected) return { ok: false, error: "topics" };
  /** @type {string[]} */
  const topics = [];
  for (const t of d.topics) {
    if (!isTopic(t) || !allowed.has(t) || topics.indexOf(t) >= 0) return { ok: false, error: "topics" };
    topics.push(t);
  }
  let pack = null;
  if (d.pack !== null) {
    const p = typeof d.pack === "string" && PACK_RE.test(d.pack) ? cat.packs.find((x) => x.id === d.pack) : undefined;
    if (!p) return { ok: false, error: "pack" };
    pack = p.id;
  }
  if (!isObj(d.marks)) return { ok: false, error: "marks" };
  const keys = Object.keys(d.marks);
  if (keys.length > LIMITS.marks) return { ok: false, error: "marks" };
  /** @type {Marks} */
  const marks = Object.create(null);
  for (const k of keys) {
    const m = d.marks[k];
    if (!isFullName(k) || !isObj(m) || !exactKeys(m, MARK_KEYS, MARK_KEYS)) return { ok: false, error: "marks" };
    if (m.mark !== "keep" && m.mark !== "skip") return { ok: false, error: "marks" };
    if (!Array.isArray(m.topics) || m.topics.length > LIMITS.markTopics || !m.topics.every(isTopic)) return { ok: false, error: "marks" };
    if (m.language !== null && (typeof m.language !== "string" || !LANGUAGE_RE.test(m.language))) return { ok: false, error: "marks" };
    marks[k] = { mark: m.mark, topics: m.topics.slice(), language: m.language };
  }
  if (!topics.length && !keys.length) return { ok: false, error: "empty" };
  return { ok: true, selection: { topics, pack: topics.length ? pack : null }, marks };
}

/** Local marks with imported ones laid over them (imported win), capped like writeMarks. */
/** @param {Marks} current @param {Marks} imported @returns {Marks} */
export function mergeMarks(current, imported) {
  /** @type {Marks} */
  const out = Object.create(null);
  for (const k of Object.keys(current)) if (!(k in imported)) out[k] = current[k];
  for (const k of Object.keys(imported)) out[k] = imported[k];
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - LIMITS.marks))) delete out[k];
  return out;
}

/** A blob: link this page made itself (for the patch download), and nothing else. */
/** @param {unknown} v @param {unknown} origin @returns {boolean} */
export function isOwnBlobUrl(v, origin) {
  return typeof v === "string" && typeof origin === "string" && /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origin) &&
    v.startsWith("blob:" + origin + "/") && /^[0-9a-fA-F-]{36}$/.test(v.slice(("blob:" + origin + "/").length));
}

// ---- Topic tags on a card -------------------------------------------------------------

/** Most topic tags shown on one card. */
export const MAX_CARD_TAGS = 8;

/**
 * The topic tags for a card: strict slugs only, each once, the ones in the patch first
 * (marked), then the others, at most `max`. The server and the browser both use this,
 * so a card marks the same topics whichever drew it.
 * @param {unknown} topics @param {Iterable<string>} selected @param {number} [max]
 * @returns {{ topic: string, match: boolean }[]}
 */
export function topicTags(topics, selected, max = MAX_CARD_TAGS) {
  const want = new Set(selected);
  const list = strings(topics, isTopic, 40);
  const hits = list.filter((t) => want.has(t));
  const rest = list.filter((t) => !want.has(t));
  return [...hits.map((t) => ({ topic: t, match: true })), ...rest.map((t) => ({ topic: t, match: false }))].slice(0, Math.max(hits.length, max));
}
