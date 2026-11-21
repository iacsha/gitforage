// The Backtest page: what gitforage's rules would have shown on 26 past Sundays, and
// how often those finds went on to reach GitHub Trending. A simulation, labelled as one.
//
// The numbers are fixed data copied from the backtest's summary.md (generated
// 2026-11-20, rules from gitforage at 79a3381). Nothing is fetched at build or view
// time. Repo names in the early-finds table are checked like any other name and every
// value still goes through the escaper.

import { repoUrl } from "@gitforage/core";
import { href, html } from "./html.ts";
import { page, type SiteContext } from "./render.ts";

export interface BacktestRun {
  name: string;
  surfaced: number;
  perWeek: number;
  caught: number;
  inScope: number;
  /** Lead to Trending in days: median, 25th and 75th percentile. */
  lead: [number, number, number];
  /** Share of matured finds that never trended or reached HN, in percent. */
  maturedNeverTrended: number;
}

export const BACKTEST = Object.freeze({
  generated: "2026-11-20",
  firstSunday: "2026-05-24",
  lastSunday: "2026-11-15",
  weeks: 26,
  outcomesThrough: "2026-11-20",
  commit: "79a3381",
  liveLedgerStart: "2026-11-20",
  runs: [
    { name: "Demo default (5 communities)", surfaced: 1033, perWeek: 41, caught: 45, inScope: 646, lead: [55, 40, 75], maturedNeverTrended: 66.7 },
    { name: "Full topic catalog (12 groups)", surfaced: 2239, perWeek: 90, caught: 85, inScope: 1025, lead: [54, 34, 74], maturedNeverTrended: 67.9 },
    { name: "Demo digest (17 topics, top 20 a week)", surfaced: 500, perWeek: 20, caught: 32, inScope: 495, lead: [53, 24, 76], maturedNeverTrended: 40 },
  ] as BacktestRun[],
  velocity: [
    { name: "Demo default, velocity only", surfaced: 1033, perWeek: 41, caught: 49, inScope: 646, lead: [55, 13, 75], maturedNeverTrended: 43.9 },
    { name: "Full catalog, velocity only", surfaced: 2179, perWeek: 87, caught: 101, inScope: 1025, lead: [56, 17, 76], maturedNeverTrended: 52.1 },
  ] as BacktestRun[],
  hn: { demo: [5, 92], full: [8, 154], medianLead: 30 },
  coverage: { starShare: 2.5, rankCorrelation: 0.82, weeklyBefore: "about 600,000", weeklyAfter: "10,000 to 60,000" },
  topFinds: [
    { repo: "floci-io/floci-az", surfaced: "2026-05-31", trending: "2026-11-03", lead: 156 },
    { repo: "Mailu/Mailu", surfaced: "2026-05-31", trending: "2026-10-24", lead: 146 },
    { repo: "pnnbao97/VieNeu-TTS", surfaced: "2026-07-26", trending: "2026-11-15", lead: 112 },
    { repo: "vinceAmstoutz/symfony-security-auditor", surfaced: "2026-06-21", trending: "2026-10-11", lead: 112 },
    { repo: "lidge-jun/opencodex", surfaced: "2026-07-26", trending: "2026-11-14", lead: 111 },
  ],
});

const pct = (n: number, d: number) => `${((n / d) * 100).toFixed(1)}%`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

function runRow(r: BacktestRun) {
  return html`<tr><th scope="row">${r.name}</th><td>${r.surfaced.toLocaleString("en-US")} <span class="muted">(${r.perWeek} a week)</span></td><td>${r.caught} of ${r.inScope.toLocaleString("en-US")} <span class="muted">(${pct(r.caught, r.inScope)})</span></td><td>${r.lead[0]} <span class="muted">(${r.lead[1]} to ${r.lead[2]})</span></td><td>${r.maturedNeverTrended}%</td></tr>`;
}

const TABLE_HEAD = html`<thead><tr><th scope="col">Run</th><th scope="col">Finds shown</th><th scope="col">Trending first-timers shown earlier</th><th scope="col">Days earlier: median (middle half)</th><th scope="col">Shown, never trended</th></tr></thead>`;

export function backtestPage(ctx: SiteContext): string {
  const b = BACKTEST;
  const full = b.runs[1], demo = b.runs[0];
  const finds = b.topFinds.filter((f) => repoUrl(f.repo)).map((f) =>
    html`<tr><th scope="row"><a href="${href(repoUrl(f.repo)!)}">${f.repo}</a></th><td>${day(f.surfaced)}</td><td>${day(f.trending)}</td><td>${f.lead}</td></tr>`);
  const body = html`<p class="crumbs"><a href="${href("about.html")}">About</a></p>
<h1>Backtest (simulated)</h1>
<p class="lede">What gitforage's rules would have brought home on ${b.weeks} past Sundays, and how often those finds later turned up on GitHub Trending. This is a replay on past data, not a record of what any portal showed.</p>
<p class="run-line">Replayed Sundays <time datetime="${b.firstSunday}">${day(b.firstSunday)}</time> to <time datetime="${b.lastSunday}">${day(b.lastSunday)}</time>, outcomes read through <time datetime="${b.outcomesThrough}">${day(b.outcomesThrough)}</time>, rules from gitforage at <code>${b.commit}</code>.</p>
<h2>What the replay found</h2>
<p>gitforage ranks by fit to a reader's interests, not by virality, so this is not a test it was built to win. Still, the field notes are worth keeping. Across the full topic catalog, the finds that did go on to trend were shown a median of <strong>${full.lead[0]} days</strong> before their first Trending day (the middle half fell between ${full.lead[1]} and ${full.lead[2]} days).</p>
<p>The other side of the ledger matters as much. The replay showed only <strong>${full.caught} of the ${full.inScope.toLocaleString("en-US")}</strong> in-topic repos that reached Trending for the first time (${pct(full.caught, full.inScope)}), and ${demo.caught} of ${demo.inScope} (${pct(demo.caught, demo.inScope)}) on the demo's five default communities. Most finds never trended at all: ${full.maturedNeverTrended}% of those shown at least eight weeks before the end never reached Trending or the Hacker News proxy. For a guide that picks what fits, that is the expected shape. Most good tools for a niche never trend.</p>
<div class="table-wrap">
<table>
<caption>Topic runs, warm-up week left out</caption>
${TABLE_HEAD}
<tbody>
${b.runs.map(runRow)}
</tbody>
</table>
</div>
<h2>A check with topics ignored</h2>
<p>The same weekly budget, spent on raw star velocity across all of GitHub with no regard for fit, caught slightly more future Trending repos and showed fewer that never trended. Topic fit does not beat raw velocity at predicting Trending. It is not meant to: velocity alone would fill a field guide with whatever is loud that week.</p>
<div class="table-wrap">
<table>
<caption>Velocity-only runs, same weekly budget</caption>
${TABLE_HEAD}
<tbody>
${b.velocity.map(runRow)}
</tbody>
</table>
</div>
<p>On Hacker News (stories linking the repo with 100 or more points, standing in for the front page), the replay caught ${b.hn.full[0]} of ${b.hn.full[1]} in-topic first-timers early on the full catalog and ${b.hn.demo[0]} of ${b.hn.demo[1]} on the demo, a median of ${b.hn.medianLead} days ahead.</p>
<h2>The longest leads</h2>
<p>From the full catalog run. A long lead may be a repo that grew slowly and then trended for an unrelated reason; these are reported as they are.</p>
<div class="table-wrap">
<table>
<caption>Five early finds with the longest lead</caption>
<thead><tr><th scope="col">Repo</th><th scope="col">Shown (simulated)</th><th scope="col">First on Trending</th><th scope="col">Days earlier</th></tr></thead>
<tbody>
${finds}
</tbody>
</table>
</div>
<h2>Caveats about the data</h2>
<ul>
<li><strong>The public star record thinned out.</strong> GH Archive, the public record of GitHub events, fell from ${b.coverage.weeklyBefore} star events a week in late 2025 to ${b.coverage.weeklyAfter} a week from July 2026, roughly a tenfold drop. Over the window it holds about ${b.coverage.starShare}% of real stars.</li>
<li><strong>Rank order still holds.</strong> Checked against true star counts, the sampled stars keep their order (a median rank correlation of ${b.coverage.rankCorrelation}), so who is growing faster is still visible. Small projects' growth, and niche patches such as HL7 and FHIR, cannot be judged fairly this way.</li>
<li><strong>Topics and descriptions are today's.</strong> A repo that added a topic after it trended gets credit for a fit it may not have had then. The velocity-only runs are the check on that.</li>
<li><strong>Some rules could not be replayed:</strong> release recency, README checks, kinship with the demo's followed projects, and visitor feedback.</li>
<li><strong>Trending archives are kept by volunteers</strong> and miss some days, so a few Trending dates may be late.</li>
<li><strong>The first replayed week is left out</strong>, because it lists everything already big when the replay began.</li>
</ul>
<h2>The live record</h2>
<p>From <time datetime="${b.liveLedgerStart}">${day(b.liveLedgerStart)}</time> the public demo keeps a live early-finds record of what it actually shows, kept apart from this simulation. The method, the coverage checks and every simulated result are published with the backtest.${ctx.earlyFinds ? html` It is on the <a href="${href("early-finds/index.html")}">Found early</a> page.` : ""}</p>`;
  return page(ctx, { title: "Backtest (simulated)", description: "A simulated replay of gitforage's rules on 26 past weeks: how often its finds later reached GitHub Trending, and how often they did not.", root: "", path: "backtest.html", nav: null, body });
}
