// Plain text, markdown and JSON renderings of a ranked list.
//
// All repo text is untrusted. Text output strips control and bidi characters (so a
// description cannot drive the terminal); markdown also escapes markdown and HTML.
// The only links emitted are https://github.com/<owner>/<repo>, rebuilt from a
// validated name, never a URL from the API body.

import { cleanText, mdEscape, repoUrl } from "./sanitize.ts";
import { topReasons } from "./scoring.ts";
import type { Scored } from "./types.ts";

const SOURCE_LABEL: Record<string, string> = { search: "new", fork: "fork", kin: "kin", rising: "rising" };
export const sourceLabel = (s: Scored) => s.candidate.sources.map((x) => SOURCE_LABEL[x] ?? x).join("+");

/** Items whose name fails validation are skipped, since they could not be linked safely. */
const linkable = (items: Scored[]) =>
  items.flatMap((s) => {
    const url = repoUrl(s.candidate.repo.full_name);
    return url ? [{ s, url }] : [];
  });

export function toText(items: Scored[]): string {
  const lines: string[] = [];
  linkable(items).forEach(({ s, url }, i) => {
    const r = s.candidate.repo;
    lines.push(`${String(i + 1).padStart(3)}. ${s.score.toFixed(1).padStart(5)}  ${r.full_name}  ★${r.stars}  [${sourceLabel(s)}]`);
    lines.push(`         ${cleanText(topReasons(s).join("; "), 400)}`);
    lines.push(`         ${url}`);
  });
  return lines.join("\n");
}

export function toMarkdown(items: Scored[], opts: { title?: string; date?: string; note?: string } = {}): string {
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const out = [`# ${mdEscape(opts.title ?? "gitforage digest")} (${mdEscape(date)})`, ""];
  if (opts.note) out.push(mdEscape(opts.note, 1000), "");
  const rows = linkable(items);
  if (!rows.length) {
    out.push("Nothing new this time.");
    return out.join("\n") + "\n";
  }
  out.push("| # | Score | Repo | Stars | Source | Why |", "|--:|------:|------|------:|--------|-----|");
  rows.forEach(({ s, url }, i) => {
    const r = s.candidate.repo;
    out.push(`| ${i + 1} | ${s.score.toFixed(1)} | [${mdEscape(r.full_name)}](${url}) | ${r.stars} | ${sourceLabel(s)} | ${mdEscape(topReasons(s).join("; "), 400)} |`);
  });
  out.push("");
  for (const { s, url } of rows) {
    const r = s.candidate.repo;
    out.push(`## ${mdEscape(r.full_name)}`, "");
    if (r.description) out.push(mdEscape(r.description, 500), "");
    out.push(`Score ${s.score.toFixed(1)}. ${mdEscape(r.language ?? "No language", 40)}. ${r.stars} stars. <${url}>`, "");
    for (const reason of s.reasons) out.push(`- ${reason.points > 0 ? "+" : ""}${reason.points} ${mdEscape(reason.text)}`);
    out.push("");
  }
  return out.join("\n");
}

/** JSON keeps raw-ish values (cleaned of control and bidi characters); consumers escape for their own format. */
export function toJson(items: Scored[]) {
  return linkable(items).map(({ s, url }) => ({
    full_name: s.candidate.repo.full_name,
    url,
    score: s.score,
    stars: s.candidate.repo.stars,
    language: s.candidate.repo.language,
    description: cleanText(s.candidate.repo.description, 500),
    sources: s.candidate.sources,
    reasons: s.reasons.map((r) => ({ ...r, text: cleanText(r.text) })),
    fork: s.candidate.fork ?? null,
    kin: s.candidate.kin ?? null,
    affinity: s.candidate.affinity ?? null,
    popularity: s.candidate.popularity ?? null,
    growth: s.candidate.growth ?? null,
    topics: s.candidate.repo.topics,
    via_topics: s.candidate.via_topics,
    created_at: s.candidate.repo.created_at,
    pushed_at: s.candidate.repo.pushed_at,
    owner: s.candidate.repo.owner,
    lang: s.candidate.spoken?.lang ?? "und",
    lang_confidence: s.candidate.spoken?.confidence ?? 0,
    star_farm: s.candidate.star_farm ?? null,
    signals: s.candidate.signals ?? null,
  }));
}
