// Fake GitHub API for tests. No network.

import { validateConfig, type Config } from "../src/config.ts";
import type { Candidate, Repo } from "../src/types.ts";

export const NOW = Date.parse("2026-11-20T12:00:00Z");
export const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

export function cfg(over: Record<string, unknown> = {}): Config {
  return validateConfig({ topics: ["hl7", "fhir"], keywords: ["MLLP"], seeds: ["acme/engine"], ...over });
}

export function rawRepo(full: string, o: Record<string, unknown> = {}): any {
  const [owner] = full.split("/");
  return {
    full_name: full, owner: { login: owner }, html_url: `https://github.com/${full}`,
    description: "", stargazers_count: 10, language: "TypeScript", topics: [],
    license: { spdx_id: "MIT" }, created_at: daysAgo(400), pushed_at: daysAgo(3),
    archived: false, disabled: false, fork: false, default_branch: "main", ...o,
  };
}

export function repo(full: string, o: Partial<Repo> = {}): Repo {
  return {
    full_name: full, owner: full.split("/")[0], html_url: `https://github.com/${full}`, description: "",
    stars: 10, language: "TypeScript", topics: [], license: "MIT", created_at: daysAgo(400),
    pushed_at: daysAgo(3), archived: false, disabled: false, fork: false, default_branch: "main",
    homepage: "", ...o,
  };
}

export function cand(full: string, o: Partial<Candidate> = {}, r: Partial<Repo> = {}): Candidate {
  return { repo: repo(full, r), sources: ["search"], via_topics: [], via_keywords: [], ...o };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

type Handler = (url: URL) => Response | Promise<Response>;

/** Routes are matched in order against pathname + search. Unmatched requests return 404. */
export function fakeApi(routes: [RegExp, Handler][]) {
  const calls: string[] = [];
  const fetch = async (u: string) => {
    const url = new URL(u);
    const key = decodeURIComponent(url.pathname + url.search);
    calls.push(key);
    for (const [re, h] of routes) if (re.test(key)) return h(url);
    return json({ message: "Not Found" }, 404);
  };
  return { fetch, calls };
}

/** A clock that only moves when sleep is called. */
export function fakeClock(start = NOW) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => { sleeps.push(ms); t += ms; },
    advance: (ms: number) => { t += ms; },
    sleeps,
  };
}
