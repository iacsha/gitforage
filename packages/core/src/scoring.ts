// Rule scoring. Each rule returns points and a reason a person can read on the card.
// Weights come from config.weights (defaults in weights.ts). A weight of 0 turns a rule off.

import type { Config } from "./config.ts";
import { starFarmText } from "./starfarm.ts";
import { daysSince, type Candidate, type Reason, type Scored } from "./types.ts";

const r1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ago(days: number): string {
  if (days === 0) return "today";
  if (days < 60) return `${days}d ago`;
  if (days < 730) return `${Math.round(days / 30)} months ago`;
  return `${Math.round(days / 365)} years ago`;
}

/**
 * Popularity is capped so it cannot outweigh fit: past ~300 stars a month or 10,000
 * stars, more stars add nothing. This also blunts star-farmed repos.
 */
export const VELOCITY_CAP = 2.5;
export const STARS_CAP = 4;
/** Affinity counts up to three top-weight profile terms' worth. */
export const AFFINITY_CAP = 3;

type Rule = (c: Candidate, cfg: Config, now: number) => Reason | null;

/** "top 5%" from a percentile; never "top 0%". */
const topShare = (pct: number) => `top ${Math.max(1, Math.ceil((1 - pct) * 100))}%`;

export const RULES: Record<string, Rule> = {
  topic_match(c, cfg) {
    const mine = new Set(cfg.topics);
    const hits = [...new Set([...c.repo.topics.map((t) => t.toLowerCase()).filter((t) => mine.has(t)), ...c.via_topics])];
    if (!hits.length) return null;
    const text = hits.length === 1 ? `your topic ${hits[0]}` : `${hits.length} of your topics (${hits.slice(0, 4).join(", ")})`;
    return { rule: "topic_match", points: cfg.weights.topic_match * Math.min(3, hits.length), text };
  },

  keyword_match(c, cfg) {
    const hay = `${c.repo.full_name} ${c.repo.description}`.toLowerCase();
    const hits = [...new Set([...cfg.keywords.filter((k) => hay.includes(k.toLowerCase())), ...c.via_keywords])];
    if (!hits.length) return null;
    return {
      rule: "keyword_match",
      points: cfg.weights.keyword_match * Math.min(3, hits.length),
      text: `matches ${hits.slice(0, 3).map((k) => `"${k}"`).join(", ")}`,
    };
  },

  /**
   * Stars per month for young repos (cheap: stars / age), total stars for older ones.
   * With a popularity percentile (the default, see popularity.ts) the points are the
   * percentile within the repo's interest times the cap; otherwise log-scaled counts.
   */
  popularity(c, cfg, now) {
    const { stars, created_at } = c.repo;
    if (stars <= 0) return null;
    const age = daysSince(created_at, now);
    const p = cfg.popularity === "topic" ? c.popularity : undefined;
    const within = p ? `, ${topShare(p.pct)} ${p.group === "*" ? "of this run" : `in ${p.group}`}` : "";
    if (age <= cfg.filters.max_age_days) {
      const perMonth = (stars / Math.max(age, 7)) * 30;
      const label = perMonth >= 1 ? `~${Math.round(perMonth)} stars a month` : `${plural(stars, "star")} since ${ago(age)}`;
      const scale = p ? p.pct * VELOCITY_CAP : Math.min(VELOCITY_CAP, Math.log10(1 + perMonth));
      return { rule: "star_velocity", points: cfg.weights.star_velocity * scale, text: `${label} (new, ${ago(age)}${within})` };
    }
    const scale = p ? p.pct * STARS_CAP : Math.min(STARS_CAP, Math.log10(1 + stars));
    return { rule: "stars", points: cfg.weights.stars * scale, text: `${plural(stars, "star")}${within}` };
  },

  /** Measured growth for older repos, from an earlier observation. Young repos use star_velocity instead. */
  star_growth(c, cfg, now) {
    const g = c.growth;
    if (!g || g.per_month <= 0 || daysSince(c.repo.created_at, now) <= cfg.filters.max_age_days) return null;
    return {
      rule: "star_growth",
      points: cfg.weights.star_growth * Math.min(VELOCITY_CAP, Math.log10(1 + g.per_month)),
      text: `+${plural(g.delta, "star")} in ${g.days}d (~${Math.round(g.per_month)} a month)`,
    };
  },

  recency(c, cfg, now) {
    const d = daysSince(c.repo.pushed_at, now);
    const w = cfg.weights.recent_push;
    if (d <= 7) return { rule: "recent_push", points: w, text: `pushed ${ago(d)}` };
    if (d <= 30) return { rule: "recent_push", points: (w * 2) / 3, text: `pushed ${ago(d)}` };
    if (d <= 90) return { rule: "recent_push", points: w / 3, text: `pushed ${ago(d)}` };
    if (d > 365 && d !== Infinity) return { rule: "stale_push", points: cfg.weights.stale_push, text: `no push since ${ago(d)}` };
    return null;
  },

  outside_prs(c, cfg) {
    const n = c.signals?.outside_prs_90d;
    if (!n) return null;
    return { rule: "outside_prs", points: cfg.weights.outside_prs * Math.min(5, n), text: `merged ${plural(n, "outside PR")} in 90 days` };
  },

  license(c, cfg) {
    if (!c.repo.license) return null;
    const name = c.repo.license === "other" ? "a license" : c.repo.license;
    return { rule: "license", points: cfg.weights.license, text: `${name} licensed` };
  },

  contributing(c, cfg) {
    if (!c.signals?.contributing) return null;
    return { rule: "contributing", points: cfg.weights.contributing, text: "has a CONTRIBUTING guide" };
  },

  good_first_issue(c, cfg) {
    const gfi = c.signals?.good_first_issues ?? 0, hw = c.signals?.help_wanted ?? 0;
    if (!gfi && !hw) return null;
    const n = (k: number) => (k >= 10 ? "10+" : String(k));
    const parts = [gfi && `${n(gfi)} good first issue${gfi === 1 ? "" : "s"}`, hw && `${n(hw)} help wanted`].filter(Boolean);
    return { rule: "good_first_issue", points: cfg.weights.good_first_issue, text: parts.join(", ") };
  },

  issue_response(c, cfg) {
    const r = c.signals?.issue_response;
    if (!r || r.total < 3) return null; // too few issues to judge
    const share = r.answered / r.total;
    return { rule: "issue_response", points: cfg.weights.issue_response * share, text: `answered ${r.answered} of ${r.total} recent issues` };
  },

  release(c, cfg, now) {
    const rel = c.signals?.latest_release;
    if (!rel?.published_at) return null;
    const d = daysSince(rel.published_at, now);
    const tag = rel.tag ? `${rel.tag} ` : "";
    if (d <= 90) return { rule: "release", points: cfg.weights.release, text: `released ${tag}${ago(d)}` };
    if (d <= 365) return { rule: "release", points: cfg.weights.release / 2, text: `released ${tag}${ago(d)}` };
    return null;
  },

  /** README quality, cheaply: a README file, a description, and a homepage (one third each). */
  readme(c, cfg) {
    const marks = [
      c.signals?.readme && "README",
      c.repo.description.trim().length >= 20 && "description",
      c.repo.homepage.trim() && "homepage",
    ].filter(Boolean) as string[];
    if (!marks.length || c.signals?.readme === undefined) return null; // only judged once signals are in
    return { rule: "readme", points: (cfg.weights.readme * marks.length) / 3, text: `docs: ${marks.join(", ")}` };
  },

  fork_ahead(c, cfg) {
    if (!c.fork || c.fork.ahead_by <= 0) return null;
    const { upstream, ahead_by, behind_by } = c.fork;
    const behind = behind_by ? `, ${behind_by} behind` : "";
    return {
      rule: "fork_ahead",
      points: cfg.weights.fork_ahead * Math.min(5, Math.log2(1 + ahead_by)),
      text: `live fork of ${upstream}: ${plural(ahead_by, "commit")} ahead${behind}`,
    };
  },

  /** Lift-weighted overlap with the terms that characterise your stars (see profile.ts). */
  affinity(c, cfg) {
    const a = c.affinity;
    if (!a || a.fit <= 0 || !a.shared.length) return null;
    const shown = a.shared.slice(0, 3).join(", ");
    return { rule: "affinity", points: cfg.weights.affinity * Math.min(AFFINITY_CAP, a.fit), text: `like your stars: ${shown}` };
  },

  /** Stars far above the repo's real activity (see starfarm.ts). */
  star_farm(c, cfg) {
    if (!c.star_farm) return null;
    return { rule: "star_farm", points: cfg.weights.star_farm, text: starFarmText(c, c.star_farm) };
  },

  /** Keep/Skip nudges per topic, owner and language (see feedback.ts). */
  feedback(c, cfg) {
    const f = c.feedback;
    if (!f) return null;
    const points = cfg.weights.feedback * (2 * f.topic + f.owner + f.language);
    if (Math.abs(points) < 0.05) return null;
    const what = f.hits.filter((h) => Math.sign(h.value) === Math.sign(points)).slice(0, 2).map((h) => `${h.kind} ${h.key}`);
    return { rule: "feedback", points, text: `like repos you ${points > 0 ? "kept" : "skipped"} (${what.join(", ")})` };
  },
};

export function scoreCandidate(c: Candidate, cfg: Config, now: number): Scored {
  const reasons: Reason[] = [];
  for (const rule of Object.values(RULES)) {
    const r = rule(c, cfg, now);
    if (r && r.points !== 0) reasons.push({ ...r, points: r1(r.points) });
  }
  reasons.sort((a, b) => b.points - a.points);
  return { candidate: c, score: r1(reasons.reduce((s, r) => s + r.points, 0)), reasons };
}

export function rank(items: Scored[]): Scored[] {
  return items.sort(
    (a, b) => b.score - a.score || b.candidate.repo.stars - a.candidate.repo.stars ||
      a.candidate.repo.full_name.localeCompare(b.candidate.repo.full_name),
  );
}

/** The reasons worth printing on a one-line card: positive ones first. */
export function topReasons(s: Scored, n = 3): string[] {
  return s.reasons.filter((r) => r.points > 0).slice(0, n).map((r) => r.text);
}
