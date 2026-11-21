// Page rendering. Every page is plain HTML with one stylesheet and one small script,
// both same-origin, under a strict Content-Security-Policy. No inline script, no
// inline style, no style attributes. All dynamic text goes through `html` (escaped).

import {
  catalogTopics, CARD_FIELDS, DENSITIES, isLanguageCode, isSafeFullName, LANGUAGES, normaliseBaseUrl, repoUrl, SORTS, withMode,
  type CardField, type CatalogItem, type Config, type Density, type Digest, type DigestItem, type Mode, type RevivalItem, type SiteConfig, type SortKey, type Weights,
} from "@gitforage/core";
import { href, html, trusted, type Html } from "./html.ts";
import { localMarks, personalBar, personalList, pickDialog } from "./personalize.ts";
import { REVIVAL_NOTE, SOURCE_LABELS, STRINGS } from "../assets/strings.js";
import { ringShapes, ringSpec, ringWords } from "../assets/rings.js";
import { fieldNote, noteHash } from "../assets/fieldnote.js";
import { topicTags } from "../assets/personalize-core.js";

/** The project's own repo, for "Run your own gitforage" and the About page. */
export const PROJECT_URL = "https://github.com/iacsha/gitforage";
export const RUN_YOUR_OWN_URL = `${PROJECT_URL}#run-your-own`;
export const FEEDBACK_TEMPLATE = "gitforage-feedback.md";
export const FEEDBACK_LABEL = "gitforage-feedback";

/** GoatCounter's versioned script and its published SRI hash. */
export const GOATCOUNTER_SCRIPT = "https://gc.zgo.at/count.v4.js";
export const GOATCOUNTER_SRI = "sha384-nRw6qfbWyJha9LhsOtSb2YJDyZdKvvCFh0fJYlkquSFjUxp9FVNugbfy8q1jdxI+";

export interface SiteContext {
  cfg: Config;
  /** owner/name of the portal repo, for Keep and Skip links. Null hides the buttons. */
  portal: string | null;
  /** Public base URL ending in /, for the feed. Null when unknown. */
  baseUrl: string | null;
  /** Build time, shown as "Updated". */
  updated: string;
}

const MODE_TITLE: Record<Mode, string> = { discover: STRINGS.discoverTitle, contribute: STRINGS.contributeTitle };
const MODE_NAV: Record<Mode, string> = { discover: STRINGS.discoverNav, contribute: STRINGS.contributeNav };
const MODE_PAGE: Record<Mode, string> = { discover: "index.html", contribute: "involved.html" };
const MODE_LEDE: Record<Mode, string> = {
  discover: STRINGS.discoverLede,
  contribute: STRINGS.contributeLede,
};

/** Display labels only: the source names themselves (search, rising, fork, kin) are data and never change. */
const SOURCE_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  fork: { ...SOURCE_LABELS.fork, cls: "badge-fork" },
  rising: { ...SOURCE_LABELS.rising, cls: "badge-rising" },
  search: { ...SOURCE_LABELS.search, cls: "badge-new" },
  kin: { ...SOURCE_LABELS.kin, cls: "badge-kin" },
};
const BADGE_ORDER = ["fork", "rising", "search", "kin"];

/** Default portal URL on GitHub Pages for a repo. */
export function pagesUrl(repo: string): string | null {
  if (!isSafeFullName(repo)) return null;
  const [o, n] = repo.split("/");
  const owner = o.toLowerCase();
  return normaliseBaseUrl(n.toLowerCase() === `${owner}.github.io` ? `https://${owner}.github.io/` : `https://${owner}.github.io/${n}/`);
}

/** The Keep or Skip link: a prefilled issue on the portal repo, the title strictly URL-encoded. */
export function feedbackUrl(portal: string, kind: "keep" | "skip", fullName: string): string {
  if (!isSafeFullName(portal) || !isSafeFullName(fullName)) throw new Error("feedback link needs validated names");
  const title = encodeURIComponent(`${kind}: ${fullName}`);
  return `https://github.com/${portal}/issues/new?template=${FEEDBACK_TEMPLATE}&title=${title}&labels=${FEEDBACK_LABEL}`;
}

export function fmtDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const anchor = (full: string) => `r-${full.replace("/", "-")}`;

/** The GitHub API origin the visitor's browser may call for "Use my GitHub stars". */
export const GITHUB_API_ORIGIN = "https://api.github.com";

/**
 * The Content-Security-Policy for every page. Analytics origins are added only when
 * configured. A page with the topic picker (`personalize`) may also connect to itself
 * (to read catalog.json) and to api.github.com (for the visitor's stars), nothing else.
 */
export function csp(site: SiteConfig, o: { personalize?: boolean } = {}): string {
  const script = ["'self'"], img = ["'self'", "data:"], connect: string[] = [];
  if (o.personalize) connect.push("'self'", GITHUB_API_ORIGIN);
  if (site.analytics) {
    const endpoint = `https://${site.analytics.code}.goatcounter.com`;
    script.push(new URL(GOATCOUNTER_SCRIPT).origin);
    img.push(endpoint);
    connect.push(endpoint);
  }
  return [
    "default-src 'none'",
    "style-src 'self'",
    "font-src 'self'",
    `script-src ${script.join(" ")}`,
    `img-src ${img.join(" ")}`,
    ...(connect.length ? [`connect-src ${connect.join(" ")}`] : []),
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

function analyticsTag(site: SiteConfig): Html {
  if (!site.analytics) return trusted("");
  return html`<script data-goatcounter="${`https://${site.analytics.code}.goatcounter.com/count`}" async src="${GOATCOUNTER_SCRIPT}" integrity="${GOATCOUNTER_SRI}" crossorigin="anonymous"></script>`;
}

/**
 * The header emblem (logo concept a, provisional): an acorn whose cap carries a git
 * branch and merge. Fixed markup, coloured by the stylesheet so it follows the theme.
 * The favicon (assets/icon.svg) is its 16px cut. Other concepts: packages/site/design/logos.html.
 */
const BRAND_MARK = trusted(`<svg class="brand-mark" viewBox="0 0 64 64" width="40" height="40" aria-hidden="true" focusable="false"><path class="logo-leaf logo-ink" d="M33 34C40 20 52 12 60 10c-1 11-8 23-22 26-2 .4-4 0-5-2z"/><path class="logo-branch" d="M35 33c7-8 14-14 21-19"/><path class="logo-twig" d="M10 58C18 50 26 42 33 34"/><path class="logo-twig logo-twig-thin" d="M21 46c-3-6-2-13 2-18M27 40c5 1 10 6 11 12"/><circle class="logo-berry logo-ink-thin" cx="23" cy="26" r="6"/><circle class="logo-berry logo-ink-thin" cx="38" cy="53" r="6"/><circle class="logo-nut logo-ink-thin" cx="16" cy="51" r="4.6"/><circle class="logo-node" cx="21" cy="24.4" r="1.6"/><circle class="logo-node" cx="36" cy="51.4" r="1.6"/></svg>`);

/** The social card every page points to, a 1200x630 PNG drawn by scripts/og-card.ts. */
export const OG_IMAGE = "assets/og-card.png";

/**
 * Open Graph and Twitter card tags. Title and description go through the escaper like
 * every value. The page URL and the card image must be absolute, so they come only from
 * the configured site.url (already checked to be a plain https:// URL) and the page's
 * own path, which the renderers build; without site.url they are left out.
 */
export function socialTags(ctx: SiteContext, o: { title: string; description: string; path: string }): Html {
  const base = ctx.cfg.site.url;
  if (base !== null && !/^https:\/\/[^\s"'<>?#]+\/$/.test(base)) throw new Error("site.url must be a plain https:// URL ending in /");
  if (!/^(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*$/.test(o.path)) throw new Error(`bad page path ${o.path}`);
  const abs = base ? (path: string) => `${base}${path}` : null;
  return html`<meta property="og:type" content="website">
<meta property="og:site_name" content="${ctx.cfg.site.title}">
<meta property="og:title" content="${o.title}">
<meta property="og:description" content="${o.description}">
${abs ? html`<meta property="og:url" content="${abs(o.path)}">
<meta property="og:image" content="${abs(OG_IMAGE)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The gitforage sprig emblem: A field guide to GitHub">
` : ""}<meta name="twitter:card" content="${abs ? "summary_large_image" : "summary"}">`;
}

type Nav = "discover" | "contribute" | "revival" | "topics" | "archive" | "about" | null;

export function page(ctx: SiteContext, o: { title: string; description: string; root: string; path: string; nav: Nav; body: Html; personalize?: boolean }): string {
  const site = ctx.cfg.site;
  const link = (key: Nav, path: string, label: string) =>
    html`<li><a href="${href(o.root + path)}"${key === o.nav ? trusted(' aria-current="page"') : ""}>${label}</a></li>`;
  const fullTitle = o.title === site.title ? site.title : `${o.title} · ${site.title}`;
  const doc = html`<!doctype html>
<html lang="en" data-lang-default="${langPref(ctx.cfg).only ? "only" : "all"}" ${layoutAttrs(site)}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp(site, { personalize: o.personalize })}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<title>${fullTitle}</title>
<meta name="description" content="${o.description}">
${socialTags(ctx, { title: fullTitle, description: o.description, path: o.path })}
<script src="${href(`${o.root}assets/theme.js`)}"></script>
<link rel="icon" href="${href(`${o.root}assets/icon.svg`)}" type="image/svg+xml">
<link rel="stylesheet" href="${href(`${o.root}assets/site.css`)}">
<link rel="alternate" type="application/atom+xml" title="${`${site.title} feed`}" href="${href(`${o.root}feed.xml`)}">
<script src="${href(`${o.root}assets/site.js`)}" defer></script>
${o.personalize ? html`<script type="module" src="${href(`${o.root}assets/personalize.js`)}"></script>
` : ""}${analyticsTag(site)}
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-head">
<div class="wrap head-row">
<a class="brand" href="${href(`${o.root}index.html`)}">${BRAND_MARK}<span class="brand-name">${site.title}</span>${site.tag ? html`<span class="brand-tag">${site.tag}</span>` : ""}</a>
<nav aria-label="Main">
<ul class="nav">
${link("discover", "index.html", STRINGS.discoverNav)}
${link("contribute", "involved.html", STRINGS.contributeNav)}
${ctx.cfg.revival.enabled ? link("revival", "revival.html", STRINGS.revivalNav) : ""}
${link("topics", "topics/index.html", STRINGS.topicsNav)}
${link("archive", "archive/index.html", STRINGS.archiveNav)}
${link("about", "about.html", STRINGS.aboutNav)}
</ul>
</nav>
${prefControls(ctx.cfg)}
</div>
</header>
<main id="main" class="wrap" tabindex="-1">
${o.body}
</main>
<footer class="site-foot">
<div class="wrap">
<p class="foot-stamp">Field guide updated <time datetime="${ctx.updated}">${fmtDate(ctx.updated)}</time> · <a href="${href(`${o.root}feed.xml`)}">Atom feed</a> · <a href="${href(`${o.root}haul/index.html`)}">The Haul</a> · <a href="${href(`${o.root}about.html`)}">How scoring works</a> · <a href="${href(`${o.root}backtest.html`)}">Backtest (simulated)</a></p>
<p><a href="${href(RUN_YOUR_OWN_URL)}">Run your own gitforage</a> · <span class="keys">Keys: <kbd>j</kbd> and <kbd>k</kbd> move between cards, <kbd>Enter</kbd> opens one.</span></p>
</div>
</footer>
</body>
</html>
`;
  return doc.value;
}

/**
 * The portal's language choice. "only" shows the config's spoken_languages (English
 * when none are set); "all" shows every card. The default is "only" when the config
 * filters languages, so with JavaScript off the server-side choice holds.
 */
export function langPref(cfg: Config): { langs: string[]; only: boolean; label: string } {
  const set = cfg.filters.spoken_languages;
  const langs = set.length ? set : ["en"];
  const names = langs.map((l) => LANGUAGES[l] ?? l);
  const label = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return { langs, only: set.length > 0, label: `${label} only` };
}

/** Whether a card matches the language choice. Undetermined matches unless drop_undetected. */
export function langMatches(cfg: Config, lang: string): boolean {
  if (lang === "und") return !cfg.filters.drop_undetected;
  return langPref(cfg).langs.includes(lang);
}

const icon = (cls: string, body: string) =>
  `<svg class="${cls}" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const THEME_ICONS = trusted([
  icon("icon icon-system", `<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>`),
  icon("icon icon-light", `<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>`),
  icon("icon icon-dark", `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
].join(""));
const LANG_ICON = trusted(icon("icon", `<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>`));

/**
 * The theme and language buttons. Both start hidden and site.js reveals them, so a
 * visitor without JavaScript never sees a control that does nothing: the theme then
 * follows the system setting and the language choice is the config's.
 */
function prefControls(cfg: Config): Html {
  const lp = langPref(cfg);
  return html`<div class="prefs">
<button type="button" class="pref-btn" data-lang-toggle aria-pressed="${lp.only ? "true" : "false"}" title="Show only cards in these languages, or cards in every language" hidden>${LANG_ICON}<span>${lp.label}</span></button>
<button type="button" class="pref-btn" data-theme-toggle aria-label="Theme: System. Switch to Light" hidden>${THEME_ICONS}<span data-theme-label>System</span></button>
${densityControl(cfg.site.layout.density)}
<p class="sr-only" data-pref-status aria-live="polite"></p>
</div>`;
}

// ---- Layout: density, card fields, sort and filters ----------------------------------
//
// The server writes the config's defaults onto <html> (data-density, data-fields-off)
// and renders the cards in the default sort order, so the page is complete with
// JavaScript off. theme.js applies a visitor's saved density and fields before paint;
// site.js wires up the controls, which stay hidden until it runs.
//
// Every data-* value below comes from a fixed list or is a number formatted here:
// nothing from repo text reaches an attribute except through the escaper, and even
// then only after matching a strict pattern.

const DENSITY_NAMES: Record<Density, string> = { comfortable: "Comfortable", compact: "Compact", list: "List" };
const SORT_NAMES: Record<SortKey, string> = { score: "Score", newest: "Newest", stars: "Stars", rising: "Rising" };
const FIELD_NAMES: Record<CardField, string> = { reasons: "Reasons", health: "Maintainer line", language: "Language", stars: "Stars" };
const SOURCE_FILTERS = ["search", "rising", "fork", "kin"] as const;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const TOPIC_TOKEN_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
/** Most topic chips shown above a list. */
export const MAX_TOPIC_CHIPS = 12;

/** The default layout attributes on <html>. Values are from fixed lists only. */
function layoutAttrs(site: SiteConfig): Html {
  const l = site.layout;
  const density = DENSITIES.includes(l.density) ? l.density : "comfortable";
  const sort = SORTS.includes(l.sort) ? l.sort : "score";
  const off = CARD_FIELDS.filter((f) => l.fields[f] === false).join(" ");
  return html`data-density="${density}" data-sort-default="${sort}" data-fields-off="${off}"`;
}

/** A plain decimal from a finite number, or "0". The output only ever matches /^-?\d+(\.\d+)?$/. */
export function numAttr(v: unknown, digits = 0): string {
  const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
  const s = Math.abs(n) >= 1e15 ? "0" : String(Number(n.toFixed(digits)));
  return /^-?\d+(\.\d+)?$/.test(s) ? s : "0";
}

/** Days since 1970 for an ISO date, 0 when unknown. */
const dayNumber = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : 0;
};

/** Star momentum: the points the star_velocity and star_growth rules gave. */
export function momentum(it: DigestItem): number {
  return it.reasons.reduce((n, r) => (r.rule === "star_velocity" || r.rule === "star_growth") && Number.isFinite(r.points) ? n + r.points : n, 0);
}

const SORT_VALUE: Record<SortKey, (it: DigestItem) => number> = {
  score: (it) => it.score,
  newest: (it) => dayNumber(it.created_at),
  stars: (it) => it.stars,
  rising: momentum,
};

/** Items in a sort order, highest first; ties keep their original order. site.js sorts the same way. */
export function sortItems<T>(items: T[], key: SortKey, of: (x: T) => DigestItem = (x) => x as unknown as DigestItem): T[] {
  const value = SORT_VALUE[key];
  return items.map((x, i) => ({ x, i, v: Number(numAttr(value(of(x)), 2)) }))
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .map((e) => e.x);
}

const itemTopics = (it: DigestItem) => [...new Set([...it.topics, ...it.via_topics])].filter((t) => TOPIC_TOKEN_RE.test(t));

/**
 * The topics offered as filter chips for a list: the config's topics that appear on
 * it (the most common ones when there are too many, kept in config order), or, for
 * a portal without topics, the most common ones on the page.
 */
export function chipTopics(cfg: Config, items: DigestItem[]): string[] {
  const counts = new Map<string, number>();
  for (const it of items) for (const t of itemTopics(it)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const mine = cfg.topics.filter((t) => counts.has(t));
  if (mine.length) {
    const keep = new Set([...mine].sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, MAX_TOPIC_CHIPS));
    return mine.filter((t) => keep.has(t));
  }
  return [...counts.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MAX_TOPIC_CHIPS).map(([t]) => t);
}

const DENSITY_ICONS: Record<Density, string> = {
  comfortable: icon("icon", `<rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/>`),
  compact: icon("icon", `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`),
  list: icon("icon", `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`),
};

/** Comfortable, Compact and List: a radio group of buttons, hidden until site.js runs. */
function densityControl(current: Density): Html {
  return html`<div class="density" role="radiogroup" aria-label="Density" data-density-group hidden>
${DENSITIES.map((d) => html`<button type="button" class="density-opt" role="radio" aria-checked="${d === current ? "true" : "false"}" tabindex="${d === current ? "0" : "-1"}" aria-label="${DENSITY_NAMES[d]}" title="${`${DENSITY_NAMES[d]} layout`}" data-density-option="${d}">${trusted(DENSITY_ICONS[d])}<span class="density-text" aria-hidden="true">${DENSITY_NAMES[d]}</span></button>`)}
</div>`;
}

/** Sort, the View menu and the filter chips above a list. Hidden until site.js runs. */
function viewBar(ctx: SiteContext, items: DigestItem[], topics: string[], hasHealth: boolean): Html {
  const l = ctx.cfg.site.layout;
  const sources = SOURCE_FILTERS.filter((s) => items.some((it) => it.sources.includes(s)));
  const fields = CARD_FIELDS.filter((f) => f !== "health" || hasHealth);
  const chip = (attr: "source" | "topic", value: string, label: string) =>
    html`<button type="button" class="filter-chip" data-filter="${attr}" data-value="${value}" aria-pressed="false">${label}</button>`;
  return html`<div class="view-bar" data-view-bar hidden>
<div class="view-row">
<label class="view-sort"><span class="view-label">Sort</span> <select data-sort-select>
${SORTS.map((k) => html`<option value="${k}"${k === l.sort ? trusted(" selected") : ""}>${SORT_NAMES[k]}</option>`)}
</select></label>
<details class="view-menu">
<summary>View</summary>
<fieldset class="view-fields">
<legend>Show on cards</legend>
${fields.map((f) => html`<label><input type="checkbox" data-field="${f}"${l.fields[f] ? trusted(" checked") : ""}> ${FIELD_NAMES[f]}</label>`)}
</fieldset>
</details>
<p class="view-count" data-filter-count aria-live="polite" aria-atomic="true"></p>
</div>
${sources.length > 1 || topics.length ? html`<div class="filter-row">
${sources.length > 1 ? html`<div class="filter-group" role="group" aria-label="Filter by source"><span class="view-label" aria-hidden="true">${STRINGS.sourceFilter}</span>${sources.map((s) => chip("source", s, SOURCE_BADGE[s].label))}</div>` : ""}
${topics.length ? html`<div class="filter-group" role="group" aria-label="Filter by topic"><span class="view-label" aria-hidden="true">${STRINGS.topicFilter}</span>${topics.map((t) => chip("topic", t, t))}</div>` : ""}
<button type="button" class="filter-clear" data-filter-clear hidden>${STRINGS.clearFilters}</button>
</div>` : ""}
</div>`;
}

function healthLine(it: DigestItem): Html {
  const h = it.health;
  if (!h) return trusted("");
  const parts: string[] = [];
  if (h.outside_prs_90d !== null) parts.push(`merged ${plural(h.outside_prs_90d, "outside pull request")} in 90 days`);
  if (h.issue_response && h.issue_response.total > 0) parts.push(`answered ${fmtNum(h.issue_response.answered)} of ${plural(h.issue_response.total, "recent issue")}`);
  if (!parts.length) return trusted("");
  return html`<p class="health"><span class="health-label">${STRINGS.maintainers}</span> ${parts.join(" · ")}</p>`;
}

/** Topics the field note may name: the portal's own and its catalog's, all strict slugs. */
function noteTopics(cfg: Config): string[] {
  return [...new Set([...cfg.topics, ...(cfg.site.personalize.enabled ? catalogTopics(cfg) : [])])].filter((t) => TOPIC_RE.test(t));
}

/** The tree-ring glyph: fixed markup around numbers and classes that rings.js formats from validated values. */
export function ringSvg(spec: ReturnType<typeof ringSpec>): Html {
  const circles = ringShapes(spec).map((c) => {
    for (const v of [c.cx, c.cy, c.r, c.w]) if (!/^\d{1,2}\.\d{2}$/.test(v)) throw new Error("bad ring number");
    if (!/^ring-[a-z]+( ring-[a-z]+)?$/.test(c.cls)) throw new Error("bad ring class");
    return c.cls === "ring-pith" ? `<circle class="${c.cls}" cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>` : `<circle class="${c.cls}" cx="${c.cx}" cy="${c.cy}" r="${c.r}" stroke-width="${c.w}"/>`;
  }).join("");
  const words = ringWords(spec);
  return html`<span class="ring" title="${words}">${trusted(`<svg class="ring-svg" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false">${circles}</svg>`)}<span class="sr-only">${words}</span></span>`;
}

const pad3 = (n: number) => numAttr(n).padStart(3, "0");

/**
 * The topic tags on a card. Topics in the patch (the portal's own topics here; the
 * visitor's picks when personalize.js draws the card) come first and are marked three
 * ways: a filled tag, a check mark, and words for screen readers, so colour is never
 * the only signal. Both marks are always present and hidden on other tags, so the
 * browser re-marks a tag by toggling the class and the hidden flags only.
 */
export function topicTagList(topics: string[], selected: string[]): Html {
  const tags = topicTags(topics, selected);
  if (!tags.length) return trusted("");
  return html`<ul class="tags" aria-label="${STRINGS.cardTopics}">${tags.map((t) => html`<li class="${t.match ? "tag tag-match" : "tag"}"><span class="tag-mark" aria-hidden="true"${t.match ? "" : trusted(" hidden")}>✓</span>${t.topic}<span class="sr-only"${t.match ? "" : trusted(" hidden")}>, ${STRINGS.topicMatch}</span></li>`)}</ul>`;
}

export function card(ctx: SiteContext, it: DigestItem, o: { health: boolean; found?: string; rank?: number; topics?: string[]; local?: boolean }): Html {
  const url = repoUrl(it.full_name);
  if (!url) return trusted("");
  const [owner, name] = it.full_name.split("/");
  const id = anchor(it.full_name);
  const badges = BADGE_ORDER.filter((s) => it.sources.includes(s as any)).map((s) => SOURCE_BADGE[s]);
  const chips = it.reasons.filter((r) => r.points > 0 && r.text).slice(0, 4);
  const pushed = fmtDate(it.pushed_at);
  const found = o.found ? fmtDate(o.found) : "";
  const actions = ctx.portal
    ? html`<div class="actions">
<a class="btn btn-keep" href="${href(feedbackUrl(ctx.portal, "keep", it.full_name))}" aria-label="${`${STRINGS.keep} ${it.full_name}: opens a prefilled GitHub issue`}">${STRINGS.keep}</a>
<a class="btn btn-skip" href="${href(feedbackUrl(ctx.portal, "skip", it.full_name))}" aria-label="${`${STRINGS.skip}: ${it.full_name}, opens a prefilled GitHub issue`}">${STRINGS.skip}</a>
</div>`
    : trusted("");
  const lang = isLanguageCode(it.lang) ? it.lang : "und";
  const match = langMatches(ctx.cfg, lang) ? "yes" : "no";
  const sources = SOURCE_FILTERS.filter((s) => it.sources.includes(s)).join(" ");
  const topics = itemTopics(it).filter((t) => o.topics?.includes(t)).join(" ");
  const spec = ringSpec(it.created_at, it.pushed_at, o.found ?? ctx.updated, momentum(it));
  const note = fieldNote({
    name: it.full_name, language: it.language, topics: itemTopics(it), allowed: noteTopics(ctx.cfg),
    years: spec.years, growth: spec.growth, sources: it.sources, health: o.health ? it.health : null,
  });
  return html`<li data-lang="${lang}" data-lang-match="${match}" data-sources="${sources}" data-topics="${topics}" data-score="${numAttr(it.score, 2)}" data-newest="${numAttr(dayNumber(it.created_at))}" data-stars="${numAttr(it.stars)}" data-rising="${numAttr(momentum(it), 2)}" data-rank="${numAttr(o.rank ?? 0)}"${o.local ? html` data-repo="${it.full_name}"` : ""}>
<article class="card" id="${id}" data-card aria-labelledby="${`${id}-t`}">
<p class="spec-line"><span class="spec-no"><span class="sr-only">${STRINGS.specimen} </span>${STRINGS.specimenShort} ${pad3((o.rank ?? 0) + 1)}</span>${it.language ? html`<span class="spec-habitat meta-lang">${STRINGS.habitat}: ${it.language}</span>` : ""}${found ? html`<span class="spec-found">${STRINGS.found} <time datetime="${o.found}">${found}</time></span>` : ""}</p>
<div class="card-head">
${ringSvg(spec)}
<h2 class="card-title" id="${`${id}-t`}"><a href="${href(url)}"><span class="owner">${owner}/</span>${name}</a></h2>
<p class="score" title="Fit score: the sum of the rule points"><span class="sr-only">Score </span>${numAttr(it.score, 1)}</p>
<p class="badges">${badges.map((b) => html`<span class="${`badge ${b.cls}`}" title="${b.title}">${b.label}</span>`)}</p>
</div>
<p class="note">${note}</p>
${it.ai_note ? html`<p class="note note-ai"><span class="desc-label">AI field note</span> ${it.ai_note}</p>
` : ""}${it.description ? html`<p class="desc"><span class="desc-label">${STRINGS.maintainerWords}</span> ${it.description}</p>` : html`<p class="desc desc-none">${STRINGS.noDescription}</p>`}
${chips.length ? html`<ul class="chips" aria-label="${STRINGS.whyHere}">${chips.map((r) => html`<li>${r.text}</li>`)}</ul>` : ""}
${topicTagList(itemTopics(it), ctx.cfg.topics)}
<ul class="meta">
<li class="meta-stars">${plural(it.stars, "star")}</li>
${pushed ? html`<li class="meta-pushed">${STRINGS.pushed} <time datetime="${it.pushed_at}">${pushed}</time></li>` : ""}
</ul>
${o.health ? healthLine(it) : ""}
${actions}
${o.local ? html`${localMarks(it.full_name)}
` : ""}</article>
</li>`;
}

function cardList(ctx: SiteContext, items: DigestItem[], o: { health: boolean; found?: (it: DigestItem) => string; pageTopic?: string; local?: boolean; map?: boolean }): Html {
  // On a topic's own page every card has that topic, so it is not offered as a chip.
  const topics = chipTopics(ctx.cfg, items).filter((t) => t !== o.pageTopic);
  const hasHealth = o.health && items.some((it) => healthLine(it).value !== "");
  const ranked = sortItems(items.map((it, rank) => ({ it, rank })), ctx.cfg.site.layout.sort, (x) => x.it);
  return html`${o.map ? forageMap(ctx, items, topics) : ""}${viewBar(ctx, items, topics, hasHealth)}
<ol class="cards" data-cards>
${ranked.map(({ it, rank }) => card(ctx, it, { health: o.health, found: o.found?.(it), rank, topics, local: o.local }))}
</ol>
<p class="empty" data-filter-empty hidden>${STRINGS.noMatch} <button type="button" class="filter-clear" data-filter-clear>${STRINGS.clearFilters}</button></p>`;
}

const emptyState = (text: string) => html`<p class="empty">${text}</p>`;

export function modePage(ctx: SiteContext, mode: Mode, latest: Digest | null): string {
  const intro = latest
    ? html`<p class="run-line">Brought home <time datetime="${latest.generated_at}">${fmtDate(latest.generated_at)}</time>: ${plural(latest.items.length, "specimen")}. <a href="${href(`archive/${latest.date}-${mode}.html`)}">Permalink</a> · <a href="${href("archive/index.html")}">${STRINGS.archiveTitle}</a></p>`
    : "";
  // The topic picker lives on the Discover page only. The default digest stays the
  // server-rendered list (all a visitor without JavaScript sees); personalize.js swaps
  // it for the personalized list when the visitor picks topics.
  const personal = mode === "discover" && ctx.cfg.site.personalize.enabled;
  const list = latest && latest.items.length
    ? cardList(ctx, latest.items, { health: mode === "contribute", local: personal, found: () => latest.generated_at, map: true })
    : emptyState(latest ? STRINGS.nothingNew : STRINGS.noDigestYet);
  const body = html`<h1>${MODE_TITLE[mode]}</h1>
<p class="lede">${MODE_LEDE[mode]}</p>
${intro}
${personal ? html`${personalBar()}
<div data-default-view>
${list}
</div>
${personalList()}
${pickDialog(ctx.cfg)}` : list}`;
  return page(ctx, { title: MODE_TITLE[mode], description: MODE_LEDE[mode], root: "", path: MODE_PAGE[mode], nav: mode, body, personalize: personal });
}

/**
 * The forage map: the list's patches drawn as hills on a contour map, more contour
 * lines for more finds. Each hill links to its patch's page (so it works without
 * JavaScript); site.js turns a click into the matching topic filter. Static SVG, built
 * here from topic slugs (strict pattern, escaped) and numbers formatted here.
 */
export function forageMap(ctx: SiteContext, items: DigestItem[], topics: string[]): Html {
  const own = topics.filter((t) => ctx.cfg.topics.includes(t) && TOPIC_RE.test(t));
  if (own.length < 3) return trusted("");
  const counts = own.map((t) => items.filter((it) => itemTopics(it).includes(t)).length);
  const max = Math.max(1, ...counts);
  const rows = own.length > 6 ? 2 : 1;
  const cols = Math.ceil(own.length / rows);
  const W = 960, rowH = 110, H = rows * rowH + 20;
  const cellW = W / cols;
  const f = (n: number) => numAttr(n, 1);
  const hills = own.map((t, i) => {
    const row = Math.floor(i / cols), col = i % cols;
    const jitter = ((t.length * 37 + i * 53) % 21) - 10;
    const cx = Math.min(W - 70, Math.max(70, (col + 0.5) * cellW + (rows > 1 ? (row ? 0.22 : -0.22) * cellW : 0)));
    const cy = 10 + rowH * (row + 0.5) + jitter * 0.6;
    const level = Math.max(1, Math.round((counts[i] / max) * 4));
    const rings = Array.from({ length: level }, (_, k) => {
      const rx = 64 - (k * 46) / Math.max(level, 1) - (4 - level) * 4;
      return `<ellipse class="hill-line hill-l${k + 1}" cx="${f(cx + k * 3)}" cy="${f(cy - k * 2)}" rx="${f(rx)}" ry="${f(rx * 0.46)}"/>`;
    }).join("");
    const label = `${t}: ${plural(counts[i], "find")}`;
    return html`<a class="hill" href="${href(`topics/${t}.html`)}" data-map-topic="${t}" aria-label="${label}">${trusted(rings)}<text class="hill-label" x="${f(cx)}" y="${f(cy + 5)}" text-anchor="middle">${t}</text><text class="hill-count" x="${f(cx)}" y="${f(cy + 22)}" text-anchor="middle">${numAttr(counts[i])}</text></a>`;
  });
  const contours = trusted(`<path class="map-contour" d="M0 ${H * 0.3} C 160 ${H * 0.15}, 320 ${H * 0.45}, 480 ${H * 0.3} S 800 ${H * 0.1}, 960 ${H * 0.28}"/><path class="map-contour" d="M0 ${H * 0.72} C 200 ${H * 0.6}, 380 ${H * 0.9}, 560 ${H * 0.74} S 860 ${H * 0.55}, 960 ${H * 0.7}"/>`);
  return html`<figure class="forage-map" aria-labelledby="forage-map-title">
<figcaption><span class="map-title" id="forage-map-title">${STRINGS.mapTitle}</span> <span class="map-note">${STRINGS.mapNote}</span></figcaption>
${trusted(`<svg class="map-svg" viewBox="0 0 ${W} ${H}" role="group" aria-labelledby="forage-map-title" focusable="false">`)}<g aria-hidden="true">${contours}</g>${hills}${trusted("</svg>")}
</figure>
`;
}

export function digestPage(ctx: SiteContext, d: Digest): string {
  const title = `${MODE_NAV[d.mode]}, ${fmtDate(d.generated_at)}`;
  const body = html`<p class="crumbs"><a href="${href("index.html")}">${STRINGS.archiveTitle}</a></p>
<h1>${title}</h1>
<p class="run-line">${plural(d.items.length, "specimen")} brought home on this walk.</p>
${d.items.length ? cardList(ctx, d.items, { health: d.mode === "contribute", found: () => d.generated_at }) : emptyState("Nothing new on this walk.")}`;
  return page(ctx, { title, description: `${MODE_NAV[d.mode]} haul from ${fmtDate(d.generated_at)}`, root: "../", path: `archive/${d.date}-${d.mode}.html`, nav: "archive", body });
}

export function archivePage(ctx: SiteContext, digests: Digest[]): string {
  const byDate = new Map<string, Digest[]>();
  for (const d of digests) byDate.set(d.date, [...(byDate.get(d.date) ?? []), d]);
  const rows = [...byDate.entries()].map(([date, ds]) => html`<li><span class="arch-date">${fmtDate(`${date}T00:00:00Z`)}</span> ${ds.map((d, i) =>
    html`${i ? " · " : ""}<a href="${href(`${d.date}-${d.mode}.html`)}">${MODE_NAV[d.mode]}</a> <span class="muted">(${plural(d.items.length, "repo")})</span>`)}</li>`);
  const body = html`<h1>${STRINGS.archiveTitle}</h1>
<p class="lede">${STRINGS.archiveLede}</p>
<p class="run-line">The best three new finds of each week are kept as numbered issues in <a href="${href("../haul/index.html")}">The Haul</a>.</p>
${rows.length ? html`<ul class="archive">${rows}</ul>` : emptyState("No hauls yet.")}`;
  return page(ctx, { title: STRINGS.archiveTitle, description: "Past gitforage digests", root: "../", path: "archive/index.html", nav: "archive", body });
}

/** Items carrying a topic, across all digests, newest listing first, each repo once. */
export function itemsForTopic(digests: Digest[], topic: string, max = 60): { item: DigestItem; listed: string }[] {
  const out: { item: DigestItem; listed: string }[] = [];
  const seen = new Set<string>();
  for (const d of digests) {
    for (const it of d.items) {
      const k = it.full_name.toLowerCase();
      if (seen.has(k) || !(it.topics.includes(topic) || it.via_topics.includes(topic))) continue;
      seen.add(k);
      out.push({ item: it, listed: d.generated_at });
      if (out.length >= max) return out;
    }
  }
  return out;
}

/** The catalog behind the Topics pages: catalog.json's items (already validated) and when they were found. */
export interface TopicCatalog { generated_at: string; items: CatalogItem[] }

/** A catalog find as a card: its base score (no topic term), no maintainer data. Null for anything without a plain name. */
export function catalogDigestItem(c: CatalogItem): DigestItem | null {
  const url = repoUrl(c.full_name);
  if (!url) return null;
  return {
    full_name: c.full_name, url, score: c.base, stars: c.stars, language: c.language, description: c.description, sources: c.sources,
    reasons: c.reasons, topics: c.topics, via_topics: [], created_at: c.created_at, pushed_at: c.pushed_at, lang: c.lang, health: null,
  };
}

/**
 * Finds for a topic: every digest listing first (newest first), then the latest
 * catalog's finds carrying it, best base score first. Each repo once, at most max.
 */
export function topicFinds(digests: Digest[], catalog: TopicCatalog | null, topic: string, max = 60): { item: DigestItem; listed: string }[] {
  const out = itemsForTopic(digests, topic, max);
  if (!catalog || out.length >= max) return out;
  const seen = new Set(out.map((x) => x.item.full_name.toLowerCase()));
  const extra = catalog.items.filter((c) => c.topics.includes(topic)).sort((a, b) => b.base - a.base || b.stars - a.stars);
  for (const c of extra) {
    const it = catalogDigestItem(c);
    if (!it || seen.has(it.full_name.toLowerCase())) continue;
    seen.add(it.full_name.toLowerCase());
    out.push({ item: it, listed: catalog.generated_at });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The topics that get a page: the portal's own, always, and with a catalog every
 * catalog topic that has finds.
 */
export function topicPageTopics(cfg: Config, digests: Digest[], catalog: TopicCatalog | null): string[] {
  const own = cfg.topics.filter((t) => TOPIC_RE.test(t));
  if (!cfg.site.personalize.enabled) return own;
  const more = catalogTopics(cfg).filter((t) => TOPIC_RE.test(t) && !own.includes(t) && topicFinds(digests, catalog, t, 1).length > 0);
  return [...own, ...more];
}

/**
 * The Topics page. With a personalize catalog it is grouped like the picker, in
 * config order, each patch with its count of finds; patches with nothing found yet
 * are listed once, quietly, at the end. Without one, the portal's own topics.
 */
export function topicsIndexPage(ctx: SiteContext, digests: Digest[], catalog: TopicCatalog | null = null): string {
  const cfg = ctx.cfg;
  const row = (t: string, n: number) => html`<li><a href="${href(`${t}.html`)}">${t}</a> <span class="muted">(${plural(n, "find")})</span></li>`;
  const groups = cfg.site.personalize.enabled ? cfg.site.personalize.groups : [];
  let body: Html;
  if (groups.length) {
    const quiet: string[] = [];
    const sections = groups.map((g) => {
      const rows = g.topics.filter((t) => TOPIC_RE.test(t)).map((t) => {
        const n = topicFinds(digests, catalog, t).length;
        if (!n && !cfg.topics.includes(t)) { quiet.push(t); return null; }
        return row(t, n);
      }).filter((x): x is Html => x !== null);
      return rows.length ? html`<section class="topic-group">
<h2>${g.name}</h2>
<ul class="topic-list">${rows}</ul>
</section>
` : "";
    });
    body = html`<h1>${STRINGS.topicsTitle}</h1>
<p class="lede">${STRINGS.topicsLedeGrouped}</p>
${sections}${quiet.length ? html`<p class="muted topic-quiet">${STRINGS.topicsQuiet} ${quiet.join(", ")}.</p>` : ""}`;
  } else {
    const rows = cfg.topics.map((t) => html`<li><a href="${href(`${t}.html`)}">${t}</a> <span class="muted">(${plural(itemsForTopic(digests, t).length, "repo")})</span></li>`);
    body = html`<h1>${STRINGS.topicsTitle}</h1>
<p class="lede">${STRINGS.topicsLede}</p>
${rows.length ? html`<ul class="topic-list">${rows}</ul>` : emptyState("This portal has no topics configured; it forages by keywords, seeds or stars.")}`;
  }
  return page(ctx, { title: STRINGS.topicsTitle, description: "Repos by topic", root: "../", path: "topics/index.html", nav: "topics", body });
}

export function topicPage(ctx: SiteContext, digests: Digest[], topic: string, catalog: TopicCatalog | null = null): string {
  const list = topicFinds(digests, catalog, topic);
  const body = html`<p class="crumbs"><a href="${href("index.html")}">${STRINGS.topicsTitle}</a></p>
<h1>${topic}</h1>
<p class="lede">Everything found in the <strong>${topic}</strong> patch, on every walk so far.</p>
${list.length
    ? cardList(ctx, list.map((x) => x.item), { health: false, found: (it) => list.find((x) => x.item === it)!.listed, pageTopic: topic })
    : emptyState("Nothing found in this patch yet.")}`;
  return page(ctx, { title: topic, description: `Repos for the ${topic} topic`, root: "../", path: `topics/${topic}.html`, nav: "topics", body });
}

const RULE_TEXT: Record<keyof Weights, string> = {
  topic_match: "per interest topic the repo carries or was found by, up to 3",
  keyword_match: "per keyword in the name or description, up to 3",
  star_velocity: "stars a month for young repos, ranked within the topic (capped)",
  stars: "total stars for older repos, ranked within the topic (capped)",
  star_growth: "stars gained a month for older repos, measured between runs (capped)",
  recent_push: "pushed in the last 7 days; less for 30 or 90 days",
  stale_push: "no push for over a year",
  release: "a release in the last 90 days; half for the last year",
  license: "has a license",
  readme: "has a README, a description and a homepage",
  affinity: "shares the topics and words that are unusual among the profile's stars and seeds",
  star_farm: "penalty when the stars look inflated: far more stars than forks, issues or contributors, or implausibly fast",
  feedback: "nudged by Keep and Leave it marks on similar repos",
  fork_ahead: "a fork with commits ahead of upstream",
  outside_prs: "per pull request merged from outside contributors in 90 days, up to 5",
  issue_response: "share of recent issues that got a reply or were closed",
  contributing: "has a CONTRIBUTING file",
  good_first_issue: "has open good first issue or help wanted issues",
};
export const RULE_DESCRIPTIONS = RULE_TEXT;

const fmtWeight = (w: number) => (w === 0 ? "off" : String(w));

function languageLine(cfg: Config): Html {
  const f = cfg.filters;
  const parts: string[] = [];
  if (f.spoken_languages.length) parts.push(`It lists repos described in ${langPref(cfg).label.replace(/ only$/, "")}${f.drop_undetected ? "" : " (and repos whose language it cannot tell)"}; the language button shows or hides the rest on pages that have them.`);
  if (f.drop_suspected_star_farms) parts.push("Repos whose stars look bought or botted (far more stars than forks, issues or contributors, or implausibly fast growth) are left out.");
  else if (cfg.weights.star_farm !== 0) parts.push("Repos whose stars look bought or botted lose points, and the card says why.");
  return parts.length ? html`<p>${parts.join(" ")}</p>` : trusted("");
}

export function aboutPage(ctx: SiteContext): string {
  const { cfg, portal } = ctx;
  const d = withMode(cfg, "discover").weights, c = withMode(cfg, "contribute").weights;
  const rules = (Object.keys(RULE_TEXT) as (keyof Weights)[]).map((k) =>
    html`<tr><th scope="row"><code>${k}</code></th><td>${fmtWeight(d[k])}</td><td>${fmtWeight(c[k])}</td><td>${RULE_TEXT[k]}</td></tr>`);
  const paras = cfg.profile.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => html`<p>${p}</p>`);
  const seeds = cfg.seeds.map((s) => html`<li><a href="${href(repoUrl(s)!)}">${s}</a></li>`);
  const fb = cfg.feedback;
  const repoLine = portal
    ? html`<p>This portal is built from <a href="${href(repoUrl(portal)!)}">${portal}</a>. Its interests file, its Keep and Leave it history and every past haul are in that repo.</p>`
    : "";
  const analytics = cfg.site.analytics
    ? html`<p>Visits are counted with <a href="${href("https://github.com/arp242/goatcounter")}">GoatCounter</a>, which sets no cookies and collects no personal data. Nothing else on this site tracks you, and the site loads nothing from other hosts.</p>`
    : html`<p>This site sets no cookies, runs no analytics and loads nothing from other hosts.</p>`;
  const body = html`<h1>${STRINGS.aboutTitle}</h1>
<p class="lede">This is a <a href="${href(PROJECT_URL)}">gitforage</a> portal, a small field guide to GitHub. Once a week it walks the topics below, looks closely at what is growing there, scores each find with plain rules, and brings home the ones it has not shown you before.</p>
${repoLine}
<h2>What it forages for</h2>
${paras}
${cfg.topics.length ? html`<p>Topics: ${cfg.topics.map((t, i) => html`${i ? ", " : ""}<a href="${href(`topics/${t}.html`)}">${t}</a>`)}.</p>` : ""}
${cfg.keywords.length ? html`<p>Keywords: ${cfg.keywords.join(", ")}.</p>` : ""}
${seeds.length ? html`<p>Projects it follows (their wild forks and kindred are foraged too):</p><ul class="seed-list">${seeds}</ul>` : ""}
${languageLine(cfg)}
<h2>Where the finds come from</h2>
<ul class="source-key">
<li><span class="badge badge-new">${SOURCE_LABELS.search.label}</span> repos created recently in these topics and keywords.</li>
<li><span class="badge badge-rising">${SOURCE_LABELS.rising.label}</span> older repos gaining stars quickly, measured from star counts seen on earlier walks.</li>
<li><span class="badge badge-fork">${SOURCE_LABELS.fork.label}</span> forks of followed projects that are ahead of upstream and recently pushed, often a revived version of a quiet project.</li>
<li><span class="badge badge-kin">${SOURCE_LABELS.kin.label}</span> repos that share the topics and words that are unusually common among the profile's stars and followed projects.</li>
</ul>
<h2>Reading a specimen card</h2>
<p>Every card carries a specimen number (its place in the haul), its habitat (the main language) and the day it was found. The small tree ring beside the name is a cross-section of the repo: one ring for each year of its age, up to five, and an outer ring that is green when it grew this week, pale when it grew this month, amber when it has gone quiet and brown when it is dormant. A wider outer ring means it is gaining stars faster, the way a good year leaves a wide ring in a trunk.</p>
<p>The field note under the name is written by plain rules from the numbers gitforage measured: age, language, patch, how it was found and how its maintainers answer. It never borrows from the repo's own text. That text sits just below, in the maintainer's words, exactly as they wrote it. When this portal also asks an AI model (the optional <code>llm</code> setting), a card can carry an <em>AI field note</em>, labelled as such. The model writes it from the repo's own text, so treat it as a second opinion that can be wrong.</p>
<h2>How scoring works</h2>
<p>Each rule adds points and a reason, and the score is the sum. The reasons are the tags on every card. Popularity is ranked within each topic and capped, so a small project that leads its niche can beat a big generic one. There is no machine learning and no paid placement: nothing here is sponsored.</p>
<p>Ranking by fit is not the same as predicting what will trend. The <a href="${href("backtest.html")}">backtest (simulated)</a> replays these rules on 26 past weeks and reports both what they caught early and what they missed.</p>
<p><strong>Discover</strong> ranks useful tools on fit, adoption, activity, releases and license. <strong>Get involved</strong> also weighs maintainers who merge outside pull requests and answer issues, starter issues, and wild forks.</p>
<div class="table-wrap">
<table>
<caption>Rule weights on this portal</caption>
<thead><tr><th scope="col">Rule</th><th scope="col">Discover</th><th scope="col">Get involved</th><th scope="col">Points for</th></tr></thead>
<tbody>
${rules}
</tbody>
</table>
</div>
<h2>Keep and Leave it</h2>
${portal
    ? html`<p>The Keep and Leave it buttons open a prefilled GitHub issue on this portal's repo. A workflow reads the title, records the mark in <code>feedback.yml</code>, replies and closes the issue. Marks nudge the ranking of similar repos (same topics, owner or language) on later runs.</p>
<p>${fb.visitors
      ? `Anyone with a GitHub account at least ${plural(fb.min_account_age_days, "day")} old can mark, up to ${plural(fb.max_per_user, "mark")} a day. A visitor's mark counts ${fb.visitor_weight} of an owner's, and only an owner's Leave it hides a repo.`
      : "Only the portal's owners and collaborators can mark; issues from anyone else are closed without being counted."}</p>`
    : html`<p>Keep and Leave it buttons appear once the portal knows its repo (<code>site.repo</code>, or the GitHub Action fills it in).</p>`}
<h2>Privacy</h2>
${analytics}
${cfg.site.personalize.enabled ? html`<p>"${STRINGS.pickPatch}" on the Discover page runs in your browser. Your picks, your "More like this" and "Hide" marks, and the topics found from your stars are kept in this browser's storage and nowhere else. "Use my GitHub stars" makes your browser ask GitHub's API for that user's public stars; gitforage never sees the username, and only the topics are kept. GitHub allows 60 such lookups an hour from one network.${cfg.site.analytics ? " When you pick a pack or a topic, its name is counted as a GoatCounter event; nothing you type is sent." : ""}</p>` : ""}
<h2 id="run-your-own">Run your own</h2>
<p>gitforage is free and MIT licensed. Start your own field guide in about five minutes: create a repo from the gitforage template, describe your interests in <code>interests.yml</code>, and turn on GitHub Pages. A weekly GitHub Action does the rest; there is no server and no paid key.</p>
<p><a class="btn" href="${href(RUN_YOUR_OWN_URL)}">Run your own gitforage</a></p>`;
  return page(ctx, { title: "About", description: "How this gitforage portal finds and scores projects", root: "", path: "about.html", nav: "about", body });
}

export const MODE_PAGES = MODE_PAGE;

// ---- Revival radar ---------------------------------------------------------------------
//
// Items come from state/revival.json, validated again by the caller (toRevivalItem):
// plain owner/repo names, counts, ISO dates, booleans and a topic slug. Links are
// rebuilt from the names; the one free-text field, the fork's release tag, is shown
// through the escaper only. The field note never reads either repo's text.

const fillNote = (t: string, vars: Record<string, string>) => t.replace(/\{([A-Za-z]+)\}/g, (_m, k: string) => (Object.hasOwn(vars, k) ? vars[k] : ""));
const capFirst = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The revival card's field note, in the guide's voice, from validated fields only. */
export function revivalNote(it: RevivalItem, now: string, allowed: string[]): string {
  const h = noteHash(it.fork.full_name);
  const topic = TOPIC_RE.test(it.upstream.topic) && allowed.includes(it.upstream.topic) ? it.upstream.topic : "";
  const where = topic ? `in the ${topic} patch` : "off the usual trails";
  const nowMs = Date.parse(now);
  const days = (iso: string) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && Number.isFinite(nowMs) ? Math.max(0, Math.floor((nowMs - t) / 86_400_000)) : null;
  };
  const quiet = days(it.upstream.pushed_at);
  const years = quiet === null ? 0 : Math.floor(quiet / 365);
  const state = it.upstream.archived ? REVIVAL_NOTE.archived : years >= 2 ? fillNote(REVIVAL_NOTE.dormantYears, { n: numAttr(Math.min(years, 50)) }) : REVIVAL_NOTE.dormant;
  const pushed = days(it.fork.pushed_at);
  const when = REVIVAL_NOTE.when[pushed === null ? 3 : pushed <= 7 ? 0 : pushed <= 31 ? 1 : pushed <= 92 ? 2 : 3];
  const ahead = Math.max(1, Number(numAttr(it.fork.ahead_by)));
  const parts = [
    fillNote(REVIVAL_NOTE.openers[h % REVIVAL_NOTE.openers.length], { where, Where: capFirst(where), state }),
    fillNote(REVIVAL_NOTE.ahead, { n: fmtNum(ahead), commits: ahead === 1 ? REVIVAL_NOTE.commit : REVIVAL_NOTE.commits, when }),
  ];
  const rel = it.fork.release ? days(it.fork.release.published_at) : null;
  if (rel !== null && rel <= 90) parts.push(REVIVAL_NOTE.release);
  if (it.points_here) parts.push(REVIVAL_NOTE.pointsHere);
  return parts.join(" ");
}

function nameLink(full: string): Html {
  const url = repoUrl(full);
  if (!url) return trusted("");
  const [owner, name] = full.split("/");
  return html`<a href="${href(url)}"><span class="owner">${owner}/</span>${name}</a>`;
}

export function revivalCard(ctx: SiteContext, it: RevivalItem, rank: number): Html {
  const up = it.upstream, f = it.fork;
  if (!isSafeFullName(up.full_name) || !isSafeFullName(f.full_name)) return trusted("");
  const id = `rv-${f.full_name.replace("/", "-")}`;
  const quiet = fmtDate(up.pushed_at);
  const upState = up.archived ? `archived${quiet ? `, last push ${quiet}` : ""}` : quiet ? `dormant since ${quiet}` : "dormant";
  const pushed = fmtDate(f.pushed_at);
  const checked = fmtDate(it.checked_at);
  const topic = TOPIC_RE.test(up.topic) && ctx.cfg.topics.includes(up.topic) ? up.topic : "";
  const forkFacts = [
    html`<li>${plural(f.ahead_by, "commit")} ahead</li>`,
    pushed ? html`<li>${STRINGS.pushed} <time datetime="${f.pushed_at}">${pushed}</time></li>` : "",
    html`<li>${plural(f.stars, "star")}</li>`,
    f.release ? html`<li>release <code>${f.release.tag}</code></li>` : "",
  ];
  return html`<li>
<article class="card revival-card" id="${id}" data-card aria-labelledby="${`${id}-t`}">
<p class="spec-line"><span class="spec-no"><span class="sr-only">${STRINGS.specimen} </span>${STRINGS.specimenShort} ${pad3(rank + 1)}</span>${topic ? html`<span class="spec-habitat">${STRINGS.topicFilter}: <a href="${href(`topics/${topic}.html`)}">${topic}</a></span>` : ""}${checked ? html`<span class="spec-found">${STRINGS.found} <time datetime="${it.checked_at}">${checked}</time></span>` : ""}</p>
<div class="card-head">
<h2 class="card-title" id="${`${id}-t`}">${nameLink(f.full_name)}</h2>
${it.points_here ? html`<p class="badges"><span class="badge badge-fork" title="${STRINGS.revivalPointsHereTitle}">${STRINGS.revivalPointsHere}</span></p>` : ""}
</div>
<p class="note">${revivalNote(it, ctx.updated, noteTopics(ctx.cfg))}</p>
<p class="revival-line"><span class="revival-label">${STRINGS.revivalParent}</span> ${nameLink(up.full_name)} <span class="muted">${upState} · ${plural(up.stars, "star")}</span></p>
<p class="revival-line"><span class="revival-label">${STRINGS.revivalCarried}</span> ${nameLink(f.full_name)}</p>
<ul class="meta">${forkFacts}</ul>
</article>
</li>`;
}

export function revivalPage(ctx: SiteContext, items: RevivalItem[]): string {
  const body = html`<h1>${STRINGS.revivalTitle}</h1>
<p class="lede">${STRINGS.revivalLede}</p>
${items.length ? html`<ol class="cards revival-cards">
${items.map((it, i) => revivalCard(ctx, it, i))}
</ol>` : emptyState(STRINGS.revivalEmpty)}`;
  return page(ctx, { title: STRINGS.revivalTitle, description: STRINGS.revivalLede, root: "", path: "revival.html", nav: "revival", body });
}
