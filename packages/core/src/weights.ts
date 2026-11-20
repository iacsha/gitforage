// Scoring weights. `mode` in interests.yml picks a preset; any key under `weights:`
// overrides that preset. A weight of 0 turns a rule off, and signals that only feed
// zero-weight rules are not fetched, so they cost no API calls.

export type Mode = "discover" | "contribute";
export const MODES: Mode[] = ["discover", "contribute"];

/** discover (the default): find useful tools. Fit, adoption, activity, releases, docs. */
export const DISCOVER_WEIGHTS = {
  /** Points per interest topic the repo carries (counted up to 3 topics). */
  topic_match: 3,
  /** Points per keyword found in name/description, or matched by a keyword search (up to 3). */
  keyword_match: 2,
  /** Multiplier on log10(1 + stars per month), capped at 2.5 (about 300 a month), for repos younger than filters.max_age_days. */
  star_velocity: 3,
  /** Multiplier on log10(1 + stars), capped at 4 (10,000 stars), for older repos where velocity cannot be derived cheaply. */
  stars: 1.5,
  /** Multiplier on log10(1 + stars gained per month), capped at 2.5, for older repos with an earlier observation (state/stars.json). */
  star_growth: 2,
  /** Pushed within 7 days. Scaled down: 2/3 of this for 30 days, 1/3 for 90 days. */
  recent_push: 3,
  /** Penalty (negative) when the last push is older than a year. */
  stale_push: -3,
  /** Latest release within 90 days; half for within a year. */
  release: 2,
  /** Licence detected. */
  license: 1,
  /** README quality markers: README file, description, homepage (fraction of the three). */
  readme: 1.5,
  /** Multiplier on how characteristic of your stars the repo's terms are (lift-weighted, capped at 3). */
  affinity: 2,
  /** Multiplier on log2(1 + commits ahead of upstream), up to 5 doublings. */
  fork_ahead: 1,
  /** Penalty (negative) when the stars look inflated for the repo's real activity (see starfarm.ts). */
  star_farm: -8,
  /** Keep/Skip feedback: multiplier on 2 * topic nudge + owner nudge + language nudge (each -1..1). */
  feedback: 1,
  /** Points per merged pull request from outside contributors in the last 90 days (up to 5). */
  outside_prs: 0,
  /** Scaled by the share of recent issues that got a reply or were closed. */
  issue_response: 0,
  /** CONTRIBUTING file present. */
  contributing: 0,
  /** Open issues labelled "good first issue" or "help wanted". */
  good_first_issue: 0,
};

export type Weights = typeof DISCOVER_WEIGHTS;

/** contribute: projects you could contribute to. Adds maintainer and newcomer signals. */
export const CONTRIBUTE_WEIGHTS: Weights = {
  ...DISCOVER_WEIGHTS,
  star_velocity: 2,
  stars: 1,
  star_growth: 1.5,
  release: 1,
  readme: 1,
  affinity: 1.5,
  fork_ahead: 2,
  outside_prs: 1,
  issue_response: 3,
  contributing: 1,
  good_first_issue: 1.5,
};

export const PRESETS: Record<Mode, Weights> = { discover: DISCOVER_WEIGHTS, contribute: CONTRIBUTE_WEIGHTS };

/** Kept for callers that want the default table. */
export const DEFAULT_WEIGHTS = DISCOVER_WEIGHTS;

export function weightsFor(mode: Mode, overrides: Partial<Weights> = {}): Weights {
  return { ...PRESETS[mode], ...overrides };
}
