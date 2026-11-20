// gitforage portal: the tree-ring glyph on every card, as plain geometry.
//
// A cross-section of a trunk: one ring per year of the repo's age (up to five), and an
// outer growth ring whose colour says how recently it was pushed and whose width says
// how fast it is gaining stars (a wide ring is a good year). The server renders it
// into the page at build time; personalize.js builds the same shapes with
// createElementNS. Both only ever see the numbers and fixed class names returned
// here: every number is a finite value formatted with toFixed, and every class comes
// from a fixed list.

import { GROWTH_WORDS, RING_WORDS } from "./strings.js";

const DAY = 86_400_000;
/** Recency classes, freshest first. The stylesheet colours each one. */
export const RING_STATES = Object.freeze(["fresh", "recent", "quiet", "dormant"]);
const MAX_RINGS = 5;
/** Outer ring width (viewBox units) for momentum buckets 0 to 3. */
const GROWTH_WIDTH = [1.2, 1.9, 2.6, 3.3];

const time = (/** @type {unknown} */ iso) => (typeof iso === "string" ? Date.parse(iso) : Number.NaN);
const fixed = (/** @type {number} */ n) => (Number.isFinite(n) ? n.toFixed(2) : "0.00");

/**
 * What the ring says about a repo, from its creation and last push dates measured at
 * `now` (the run that found it), and its star momentum in rule points.
 * @param {unknown} created @param {unknown} pushed @param {unknown} now @param {unknown} momentum
 */
export function ringSpec(created, pushed, now, momentum) {
  const n = time(now), c = time(created), p = time(pushed);
  const age = Number.isFinite(n) && Number.isFinite(c) ? Math.max(0, (n - c) / (365.25 * DAY)) : 0;
  const idle = Number.isFinite(n) && Number.isFinite(p) ? Math.max(0, (n - p) / DAY) : Number.POSITIVE_INFINITY;
  const m = typeof momentum === "number" && Number.isFinite(momentum) ? momentum : 0;
  return {
    years: Math.min(MAX_RINGS, Math.floor(age) + 1),
    state: idle <= 7 ? "fresh" : idle <= 30 ? "recent" : idle <= 90 ? "quiet" : "dormant",
    growth: m >= 3 ? 3 : m >= 1.5 ? 2 : m > 0 ? 1 : 0,
  };
}

/**
 * The circles to draw in a 24 by 24 viewBox, innermost first: the pith, one ring per
 * year, then the outer growth ring. Rings sit slightly off-centre, as real ones do.
 * @param {{ years: number, state: string, growth: number }} spec
 */
export function ringShapes(spec) {
  const state = RING_STATES.includes(spec.state) ? spec.state : "dormant";
  const growth = Math.max(0, Math.min(3, Math.floor(Number(spec.growth) || 0)));
  const years = Math.max(1, Math.min(MAX_RINGS, Math.floor(Number(spec.years) || 1)));
  const width = GROWTH_WIDTH[growth];
  const outer = 11.6 - width / 2;
  const inner = outer - width / 2 - 1.1;
  const shapes = [{ cls: "ring-pith", cx: "12.00", cy: "12.00", r: "1.40", w: "0.00" }];
  for (let i = 1; i < years; i++) {
    const r = 1.4 + (i * (inner - 1.4)) / (years - 0.4);
    shapes.push({ cls: "ring-year", cx: fixed(12 + i * 0.22), cy: fixed(12 - i * 0.12), r: fixed(r), w: "0.90" });
  }
  shapes.push({ cls: `ring-growth ring-${state}`, cx: "12.00", cy: "12.00", r: fixed(outer), w: fixed(width) });
  return shapes;
}

/** The ring in words, for screen readers and the hover title. @param {{ years: number, state: string, growth: number }} spec */
export function ringWords(spec) {
  const state = /** @type {keyof typeof RING_WORDS} */ (RING_STATES.includes(spec.state) ? spec.state : "dormant");
  const years = spec.years <= 1 ? "under a year old" : spec.years === 2 ? "about a year old"
    : spec.years >= MAX_RINGS ? `${MAX_RINGS - 1} or more years old` : `about ${spec.years - 1} years old`;
  return `Tree ring: ${years}, ${RING_WORDS[state]}, ${GROWTH_WORDS[spec.growth] ?? GROWTH_WORDS[0]}`;
}
