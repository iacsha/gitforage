// "Pick your topics" (site.personalize): the catalog.json the browser re-ranks, and the
// markup for the picker dialog and the personalized list on the Discover page.
//
// The dialog is rendered here, on the server, from the config (topics are strict slugs,
// group and pack names are checked plain text, and all of it still goes through the
// escaper). The browser only ticks boxes and fills the personalized list, building every
// node with createElement and textContent (assets/personalize.js).

import {
  catalogTopics, selectCatalog, toCatalogItem, withMode, type CatalogItem, type CatalogState, type Config,
} from "@gitforage/core";
import { html, trusted, type Html } from "./html.ts";

export interface CatalogFile {
  version: 1;
  generated_at: string;
  /** owner/name of the portal repo for Keep and Skip links, or null. */
  portal: string | null;
  /** The weights the browser adds on top of each item's base score. */
  weights: { topic_match: number; feedback: number };
  topics: string[];
  groups: { name: string; topics: string[] }[];
  packs: { id: string; name: string; topics: string[] }[];
  /** The portal's spoken languages, for the language button. */
  spoken: string[];
  drop_undetected: boolean;
  /** Whether GoatCounter is on (pick events are only sent then). */
  analytics: boolean;
  /** Candidates kept per topic at most. */
  per_topic: number;
  items: CatalogItem[];
}

/**
 * catalog.json for the portal: the state file's items checked again (as if a stranger
 * wrote them), cut to the current config's topics and per-topic cap, within the byte budget.
 */
export function catalogFile(cfg: Config, state: CatalogState | null, portal: string | null): CatalogFile {
  const p = cfg.site.personalize;
  const topics = catalogTopics(cfg);
  const allowed = new Set(topics);
  const valid: CatalogItem[] = [];
  const seen = new Set<string>();
  for (const v of state?.items ?? []) {
    const it = toCatalogItem(v, allowed);
    if (typeof it === "string" || seen.has(it.full_name.toLowerCase())) continue;
    seen.add(it.full_name.toLowerCase());
    valid.push(it);
  }
  const sel = selectCatalog(valid, topics, p.per_topic);
  const w = withMode(cfg, "discover").weights;
  return {
    version: 1,
    generated_at: state?.generated_at ?? "",
    portal,
    weights: { topic_match: w.topic_match, feedback: w.feedback },
    topics,
    groups: p.groups.map((g) => ({ name: g.name, topics: g.topics.filter((t) => allowed.has(t)) })),
    packs: p.packs.map((k) => ({ id: k.id, name: k.name, topics: k.topics.filter((t) => allowed.has(t)) })),
    spoken: cfg.filters.spoken_languages,
    drop_undetected: cfg.filters.drop_undetected,
    analytics: cfg.site.analytics !== null,
    per_topic: sel.per_topic,
    items: sel.items,
  };
}

const icon = (body: string) =>
  `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const PICK_ICON = trusted(icon(`<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="17" cy="6" r="2"/><circle cx="14" cy="18" r="2"/>`));
const CLOSE_ICON = trusted(icon(`<path d="M6 6l12 12M18 6L6 18"/>`));

/**
 * The bar above the Discover list: the "Pick your topics" button, the summary, Copy
 * link and Reset. Hidden until personalize.js runs, so it never shows without JavaScript.
 */
export function personalBar(): Html {
  return html`<div class="personal-bar" data-personal-bar hidden>
<button type="button" class="pref-btn pick-open" data-pick-open aria-haspopup="dialog" aria-controls="pick-dialog">${PICK_ICON}<span>Pick your topics</span></button>
<p class="personal-summary" data-personal-summary aria-live="polite" aria-atomic="true"></p>
<button type="button" class="filter-clear" data-copy-link hidden>Copy link</button>
<button type="button" class="filter-clear" data-personal-reset hidden>Reset to the default view</button>
<label class="share-url" data-share-wrap hidden><span class="sr-only">Link to this view</span> <input type="text" readonly data-share-url></label>
</div>`;
}

/** The personalized list, filled by personalize.js. Empty and hidden in the page itself. */
export function personalList(): Html {
  return html`<section class="personal" data-personal hidden aria-labelledby="personal-title">
<h2 class="sr-only" id="personal-title">Repos for your topics</h2>
<ol class="cards" data-pcards></ol>
<p class="empty" data-personal-empty hidden>No repos in the catalog carry these topics yet. Pick more topics, or reset to the default view.</p>
<p class="more"><button type="button" class="btn" data-personal-more hidden>Show more</button></p>
</section>`;
}

/**
 * The picker: a modal <dialog> labelled by its heading and described by the privacy
 * note. personalize.js opens it with showModal() (which makes the page behind it
 * inert), keeps Tab inside it, closes it on Esc and returns focus to the button.
 */
export function pickDialog(cfg: Config): Html {
  const p = cfg.site.personalize;
  const packs = p.packs.map((k) => html`<button type="button" class="filter-chip" data-pack="${k.id}" aria-pressed="false">${k.name}</button>`);
  const groups = p.groups.map((g, i) => html`<fieldset class="pick-group" data-pick-group>
<legend>${g.name}</legend>
<div class="pick-topics">${g.topics.map((t) => html`<label class="pick-topic" data-topic-row="${t}"><input type="checkbox" data-topic="${t}"> ${t}</label>`)}</div>
</fieldset>${i < p.groups.length - 1 ? "\n" : ""}`);
  return html`<dialog class="pick" id="pick-dialog" aria-labelledby="pick-title" aria-describedby="pick-privacy" data-pick-dialog>
<div class="pick-head">
<h2 id="pick-title">Pick your topics</h2>
<button type="button" class="pick-x" data-pick-cancel aria-label="Close without changes">${CLOSE_ICON}</button>
</div>
<p class="pick-note" id="pick-privacy">Your picks and marks stay in this browser. Nothing is sent to gitforage.</p>
<div class="pick-body">
${packs.length ? html`<section class="pick-section" aria-labelledby="pick-packs-title">
<h3 id="pick-packs-title">Starter packs</h3>
<div class="pick-packs" role="group" aria-labelledby="pick-packs-title">${packs}</div>
</section>` : ""}
<section class="pick-section" aria-labelledby="pick-stars-title">
<h3 id="pick-stars-title">Use my GitHub stars</h3>
<div class="pick-stars">
<label for="pick-user">GitHub username</label>
<input id="pick-user" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="39" aria-describedby="pick-stars-note" data-stars-user>
<button type="button" class="btn" data-stars-go>Use my GitHub stars</button>
</div>
<p class="pick-small" id="pick-stars-note">Your browser asks GitHub directly; gitforage never sees your username. Only the topics it finds are kept, in this browser.</p>
<p class="pick-status" role="status" aria-live="polite" data-stars-status></p>
<p class="pick-small" data-stars-cached hidden><span data-stars-cached-text></span> <button type="button" class="filter-clear" data-stars-reuse>Use these</button></p>
</section>
<section class="pick-section" aria-labelledby="pick-topics-title">
<h3 id="pick-topics-title">Topics</h3>
<p class="pick-search"><label for="pick-search">Search topics</label> <input id="pick-search" type="search" autocomplete="off" spellcheck="false" maxlength="50" aria-controls="pick-topic-list" data-topic-search></p>
<div class="pick-groups" id="pick-topic-list">
${groups}
</div>
<p class="pick-small" data-topic-none hidden>No topics match that search.</p>
</section>
<section class="pick-section" aria-labelledby="pick-marks-title">
<h3 id="pick-marks-title">Your marks in this browser</h3>
<p class="pick-small"><span data-marks-count>No marks yet.</span> <button type="button" class="filter-clear" data-marks-clear>Clear my local marks</button></p>
</section>
</div>
<div class="pick-foot">
<p class="pick-count" aria-live="polite" aria-atomic="true" data-pick-count></p>
<button type="button" class="btn btn-keep" data-pick-apply>Show my repos</button>
<button type="button" class="btn" data-pick-none>Clear picks</button>
<button type="button" class="btn" data-pick-cancel>Cancel</button>
</div>
</dialog>`;
}

/** The local Keep/Skip buttons on a card ("More like this" and "Hide", this browser only). Hidden until personalize.js runs. */
export function localMarks(full: string): Html {
  return html`<div class="local-marks" data-local-marks hidden>
<button type="button" class="local-btn" data-local-mark="keep" aria-pressed="false" aria-label="${`More like ${full}, in this browser only`}">More like this</button>
<button type="button" class="local-btn" data-local-mark="skip" aria-pressed="false" aria-label="${`Hide ${full}, in this browser only`}">Hide</button>
</div>`;
}
