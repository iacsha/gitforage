// Signals for the top candidates only. Each one is fetched only when a rule that uses
// it has a non-zero weight, so discover mode skips the contributor signals entirely.
//
// Cost per candidate (calls):
//   community profile (README, CONTRIBUTING)  1 core   readme, contributing
//   latest release                            1 core   release
//   recent issues (response)                  1 core   issue_response
//   good first issue / help wanted            2 core   good_first_issue
//   merged outside PRs, 90 days               1 search outside_prs
//   contributors (star-farm guard)            1 core   star_farm, only for repos with 2,000+ stars

import type { GitHub } from "./github.ts";
import type { Weights } from "./weights.ts";
import { DAY_MS, isoDate, type Signals } from "./types.ts";

/** Authors GitHub marks as not part of the repo's own team. */
const OUTSIDE = new Set(["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "NONE"]);

export function countOutsidePrs(items: any[]): number {
  return items.filter((i) => OUTSIDE.has(i.author_association) && i.user?.type !== "Bot").length;
}

/** Of recent issues opened more than 2 days ago (not PRs, not by bots), how many got a reply or were closed. */
export function issueResponse(items: any[], now: number): { answered: number; total: number } {
  const old = items.filter((i) => !i.pull_request && i.user?.type !== "Bot" && now - Date.parse(i.created_at) > 2 * DAY_MS);
  return { answered: old.filter((i) => i.comments > 0 || i.state === "closed").length, total: old.length };
}

const on = (w: Weights, ...keys: (keyof Weights)[]) => keys.some((k) => w[k] !== 0);

export async function fetchSignals(gh: GitHub, fullName: string, weights: Weights, now: number, opts: { contributors?: boolean } = {}): Promise<Signals> {
  const s: Signals = {};

  if (opts.contributors) {
    // One page of up to 100 is enough: the guard only asks whether there are one or two.
    // GitHub answers 403 when a history is too large to list, and 204 for an empty repo.
    const list = await gh.get<any[]>(`/repos/${fullName}/contributors?per_page=100`, { allow: [403, 404] });
    s.contributors = Array.isArray(list) ? list.length : null;
  }

  if (on(weights, "readme", "contributing")) {
    const community = await gh.get<any>(`/repos/${fullName}/community/profile`, { allow: [403, 404] });
    s.readme = community ? Boolean(community.files?.readme) : null;
    s.contributing = community ? Boolean(community.files?.contributing) : null;
  }

  if (on(weights, "release")) {
    const rel = await gh.get<any[]>(`/repos/${fullName}/releases?per_page=1`, { allow: [404] });
    const r = rel?.[0];
    s.latest_release = r && !r.draft ? { tag: String(r.tag_name ?? r.name ?? ""), published_at: String(r.published_at ?? r.created_at ?? "") } : null;
  }

  if (on(weights, "issue_response")) {
    const items = await gh.get<any[]>(`/repos/${fullName}/issues?state=all&sort=created&direction=desc&per_page=30`, { allow: [404, 410] });
    s.issue_response = items ? issueResponse(items, now) : null;
  }

  if (on(weights, "good_first_issue")) {
    const count = async (label: string) => {
      const items = await gh.get<any[]>(`/repos/${fullName}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=10`, { allow: [404, 410] });
      return items ? items.filter((i) => !i.pull_request).length : null;
    };
    s.good_first_issues = await count("good first issue");
    s.help_wanted = await count("help wanted");
  }

  if (on(weights, "outside_prs")) {
    const since = isoDate(now - 90 * DAY_MS);
    const q = encodeURIComponent(`repo:${fullName} is:pr is:merged merged:>=${since}`);
    const prs = await gh.get<{ items: any[] }>(`/search/issues?q=${q}&per_page=100`, { allow: [422] });
    s.outside_prs_90d = prs ? countOutsidePrs(prs.items ?? []) : null;
  }

  return s;
}
