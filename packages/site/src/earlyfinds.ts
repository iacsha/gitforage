// The Found early page (early-finds/index.html): the live record of finds this portal
// showed before they reached GitHub Trending, the Hacker News front page or a star
// milestone. Kept apart from the Backtest page, which is a simulation.
//
// The ledger comes from state/early-finds.json and is validated again here
// (validateEarlyFinds): plain owner/repo names, dates and counts only. Repo links are
// rebuilt from the validated name, and every value goes through the escaper.

import { earlyFinds, median, repoUrl, trackingSince, validateEarlyFinds, type EarlyEvent, type EarlyFindsLedger } from "@gitforage/core";
import { href, html } from "./html.ts";
import { fmtDate, page, type SiteContext } from "./render.ts";

export const EARLY_FINDS_PATH = "early-finds/index.html";
export const EARLY_FINDS_TITLE = "Found early";

/** The ledger, validated again, when it has at least one repo; else null (no page). */
export function earlyFindsForBuild(raw: EarlyFindsLedger | null | undefined): EarlyFindsLedger | null {
  if (!raw) return null;
  const { ledger } = validateEarlyFinds(raw);
  return Object.keys(ledger.repos).length ? ledger : null;
}

const fmtDay = (day: string) => fmtDate(`${day}T00:00:00Z`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

function label(e: EarlyEvent): string {
  if (e.kind === "trending") return "GitHub Trending";
  if (e.kind === "hn") return "Hacker News front page";
  return `${(e.milestone ?? 0).toLocaleString("en-US")} stars`;
}

export function earlyFindsPage(ctx: SiteContext, ledger: EarlyFindsLedger): string {
  const finds = earlyFinds(ledger);
  const since = trackingSince(ledger) ?? "";
  const tracked = Object.keys(ledger.repos).length;
  const leads = finds.map((f) => f.events[0].lead);
  const med = median(leads);
  const count = (k: EarlyEvent["kind"]) => finds.filter((f) => f.events.some((e) => e.kind === k)).length;
  const sinceTag = html`<time datetime="${since}">${fmtDay(since)}</time>`;

  const headline = finds.length
    ? html`<p class="lede"><strong>${plural(finds.length, "find")}</strong> later reached GitHub Trending, the Hacker News front page or a star milestone, a median of <strong>${plural(med ?? 0, "day")}</strong> after gitforage first showed them.</p>
<p class="run-line">Of those, ${count("trending")} reached Trending, ${count("hn")} the HN front page and ${count("stars")} a star milestone. ${plural(tracked, "repo")} tracked since ${sinceTag}.</p>`
    : html`<p class="lede">Tracking since ${sinceTag}, nothing has reached Trending yet.</p>
<p class="run-line">${plural(tracked, "repo")} shown by this portal are watched every day for GitHub Trending, the Hacker News front page and star milestones. Finds appear here once one of them gets there.</p>`;

  const rows = finds.flatMap((f) => {
    const url = repoUrl(f.name);
    if (!url) return [];
    const [first, ...rest] = f.events;
    return [html`<tr><th scope="row"><a href="${href(url)}">${f.name}</a></th><td><time datetime="${f.first_seen}">${fmtDate(f.first_seen)}</time></td><td>${label(first)}${rest.length ? html` <span class="muted">(then ${rest.map(label).join(", ")})</span>` : ""}</td><td><time datetime="${first.date}">${fmtDay(first.date)}</time></td><td>${first.lead}</td></tr>`];
  });

  const body = html`<p class="crumbs"><a href="${href("../about.html")}">About</a></p>
<h1>${EARLY_FINDS_TITLE}</h1>
${headline}
${rows.length ? html`<div class="table-wrap">
<table>
<caption>Live record, longest lead first</caption>
<thead><tr><th scope="col">Repo</th><th scope="col">First shown</th><th scope="col">Reached</th><th scope="col">On</th><th scope="col">Days later</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</div>` : ""}
<h2>How this is counted</h2>
<p>This is the live record, not a simulation. Every repo this portal shows is added to the record, and since <time datetime="${since}">${fmtDay(since)}</time> a daily check looks at GitHub Trending (all languages, daily), the Hacker News front page (stories linking the repo) and the repo's stars (milestones of 1,000, 5,000, 10,000, 25,000 and 50,000, each repo looked up about once a week).</p>
<ul>
<li><strong>Only later counts.</strong> A repo that reached Trending or the front page on the day it was first shown, or before, is not counted, and neither is a milestone it had already passed at its first check. A repo already big when it was shown is not an early find.</li>
<li><strong>Only what was watched counts.</strong> Trending and the front page are credited only for repos watched from the day they were shown (or the day after) and only after the first day each check worked for them, so a repo shown before tracking began, or on a day a check failed, cannot claim a lead it was never seen earning. A milestone counts only when the star count at the first lookup is known and below it.</li>
<li><strong>Before it was shown is not seen.</strong> A repo that trended in the days before this portal first showed it, and again later, can still appear here: the record only starts on the day it was shown.</li>
<li><strong>Dates are as observed.</strong> Trending and the front page are read once a day, so their dates are the day seen. Stars are looked up about once a week, so a milestone date can be up to six days after the real crossing, and its lead that much longer.</li>
<li><strong>Misses are not shown.</strong> Most finds never trend, and a guide that ranks by fit is not built to predict what will. This page lists the ones that did.</li>
</ul>
<p>For a replay of the same rules on past weeks, with the hit rate and the misses, see the <a href="${href("../backtest.html")}">Backtest (simulated)</a>. The two are kept apart: nothing simulated is counted here.</p>`;
  return page(ctx, {
    title: EARLY_FINDS_TITLE,
    description: "The live record: finds this gitforage portal showed before they reached GitHub Trending, the Hacker News front page or a star milestone.",
    root: "../", path: EARLY_FINDS_PATH, nav: null, body,
  });
}
