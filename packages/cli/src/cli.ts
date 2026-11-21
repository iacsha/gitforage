#!/usr/bin/env bun
// gitforage CLI. `preview` prints a ranked list and writes nothing but the API cache.
// `run` reports only items not yet in state/seen.json, records them, emits markdown and
// keeps the digest in state/digests/ for the portal. `site` builds the static portal.
// `feedback` folds Keep/Skip issues into feedback.yml.

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ConfigError, GitHub, RateLimitError, forage, loadConfig, loadFeedback, loadSeen, loadStars, markSeen, saveSeen, saveStars,
  seenKeys, toJson, toMarkdown, toText, tokenFromEnv, withMode, MODES, type Config, type ForageResult, type Mode,
  appendFeedback, llmRerank, loadRevival, saveRevival, revivalText, catalogTopics, cleanText, loadCatalog, saveCatalog, selectCatalog, toCatalogItems, type CatalogState, type RevivalItem, intake, issuesFrom, isSafeFullName, isSafeLogin, isoDate, loadDigests, replyFor, saveDigest, toDigestItems, toRepo,
} from "@gitforage/core";
import { MAX_HAUL_NOTES_BYTES, parseHaulNotes, renderSite, siteBinaries, writeSite } from "@gitforage/site";

const HELP = `gitforage: personalized GitHub discovery

Usage:
  gitforage preview [--config interests.yml] [--mode discover|contribute] [--limit N] [--json] [--out preview.md]
  gitforage run     [--config interests.yml] [--mode discover|contribute] [--limit N] [--out digest.md] [--json] [--state state/seen.json]
  gitforage site    [--config interests.yml] --out DIR [--repo owner/name] [--state state/seen.json]
  gitforage feedback [--config interests.yml] [--event FILE] [--issues FILE] [--replies DIR] [--json]

Options:
  --config FILE   interests file (default: ./interests.yml)
  --mode MODE     discover (find useful tools) or contribute (projects to contribute to);
                  overrides mode in the config
  --limit N       how many items to show (default: digest_size from the config)
  --json          print JSON instead of text or markdown
  --out FILE      write markdown (or JSON with --json) to FILE instead of stdout
  --state FILE    run only: seen-state file (default: state/seen.json next to the config).
                  Star counts for growth are kept beside it in stars.json (read by
                  preview, written by run)
  --feedback FILE Keep/Skip marks (default: feedback.yml next to the config, if present)
  --repo NAME     site: the portal repo (owner/name) for Keep and Skip links;
                  overrides site.repo in the config
  --event FILE    feedback: a GitHub issues event (JSON), e.g. "$GITHUB_EVENT_PATH"
  --issues FILE   feedback: a JSON list of issues, as the REST API returns them
                  (without --event or --issues, GITFORAGE_ISSUES_JSON is read)
  --replies DIR   feedback: write one reply per handled issue to DIR/<number>.md
  --cache-dir DIR response cache (default: .gitforage/cache next to the config)
  --no-cache      skip the response cache for this run
  --quiet         no progress or stats on stderr
  --debug         preview and run: list every dropped repo with its reason on stderr

Auth: set GITHUB_TOKEN (or GH_TOKEN). Without one, GitHub allows 60 requests an hour.
`;

export interface Args {
  cmd: string;
  config: string;
  limit?: number;
  mode?: Mode;
  json: boolean;
  out?: string;
  state?: string;
  feedback?: string;
  cacheDir?: string;
  repo?: string;
  event?: string;
  issues?: string;
  replies?: string;
  noCache: boolean;
  quiet: boolean;
  debug: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): Args {
  const a: Args = { cmd: argv[0] ?? "help", config: "interests.yml", json: false, noCache: false, quiet: false, debug: false };
  const need = (i: number, flag: string) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} needs a value`);
    return v;
  };
  for (let i = 1; i < argv.length; i++) {
    const f = argv[i];
    switch (f) {
      case "--config": a.config = need(i++, f); break;
      case "--limit": {
        const n = Number(need(i++, f));
        if (!Number.isInteger(n) || n < 1) throw new UsageError("--limit must be a whole number of 1 or more");
        a.limit = n;
        break;
      }
      case "--mode": {
        const m = need(i++, f) as Mode;
        if (!MODES.includes(m)) throw new UsageError(`--mode must be one of ${MODES.join(", ")}`);
        a.mode = m;
        break;
      }
      case "--json": a.json = true; break;
      case "--out": a.out = need(i++, f); break;
      case "--state": a.state = need(i++, f); break;
      case "--feedback": a.feedback = need(i++, f); break;
      case "--cache-dir": a.cacheDir = need(i++, f); break;
      case "--repo": {
        const r = need(i++, f);
        if (!isSafeFullName(r)) throw new UsageError("--repo must look like owner/name");
        a.repo = r;
        break;
      }
      case "--event": a.event = need(i++, f); break;
      case "--issues": a.issues = need(i++, f); break;
      case "--replies": a.replies = need(i++, f); break;
      case "--no-cache": a.noCache = true; break;
      case "--quiet": a.quiet = true; break;
      case "--debug": a.debug = true; break;
      case "-h": case "--help": a.cmd = "help"; break;
      default: throw new UsageError(`unknown option ${f}`);
    }
  }
  return a;
}

/** " (3 in other languages, 1 star farm)" for the summary line. */
export function excludedBreakdown(res: Pick<ForageResult, "excluded">): string {
  const lang = res.excluded.filter((e) => e.reason.startsWith("written in") || e.reason.startsWith("language of the description")).length;
  const farm = res.excluded.filter((e) => e.reason.startsWith("stars look inflated")).length;
  const parts = [lang && `${lang} in other languages`, farm && `${farm} suspected star ${farm === 1 ? "farm" : "farms"}`].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function stats(gh: GitHub, started: number, res: ForageResult): string {
  const s = gh.stats;
  const core = gh.buckets.core, search = gh.buckets.search;
  const left = [core && `core ${core.remaining}/${core.limit}`, search && `search ${search.remaining}/${search.limit}`].filter(Boolean).join(", ");
  return [
    `found: ${res.found.search} search, ${res.found.rising} rising, ${res.found.fork} fork, ${res.found.kin} kin${res.found.catalog !== undefined ? `, ${res.found.catalog} catalog only` : ""}; ${res.excluded.length} excluded${excludedBreakdown(res)}` +
      (res.skipped_seen ? `, ${res.skipped_seen} already seen` : ""),
    `api: ${s.network} requests, ${s.cacheHits} from cache, ${s.retries} retries, waited ${Math.round(s.waitedMs / 1000)}s` +
      (left ? `; remaining ${left}` : ""),
    `time: ${((Date.now() - started) / 1000).toFixed(1)}s`,
  ].join("\n");
}

export async function main(argv: string[], env = process.env): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(`gitforage: ${(e as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (args.cmd === "help") { console.log(HELP); return 0; }
  if (!["preview", "run", "site", "feedback"].includes(args.cmd)) {
    console.error(`gitforage: unknown command "${args.cmd}"\n\n${HELP}`);
    return 2;
  }

  let cfg: Config;
  try {
    cfg = loadConfig(args.config);
  } catch (e) {
    if (e instanceof ConfigError) { console.error(e.message); return 2; }
    throw e;
  }
  if (args.mode) cfg = withMode(cfg, args.mode);
  const base = dirname(resolve(args.config));
  const log = args.quiet ? () => {} : (m: string) => console.error(`· ${m}`);
  log(`mode: ${cfg.mode}`);
  if (args.cmd === "site") return site(args, cfg, base, log);
  if (args.cmd === "feedback") return feedback(args, cfg, base, env, log);

  const token = tokenFromEnv(env);
  if (!token) log("no GITHUB_TOKEN or GH_TOKEN set: limited to 60 requests an hour, expect a partial result");
  const gh = new GitHub({
    token,
    cacheDir: args.noCache ? null : resolve(args.cacheDir ?? join(base, ".gitforage", "cache")),
    ttlMs: cfg.cache.ttl_hours * 3_600_000,
    log,
  });

  const started = Date.now();
  const statePath = resolve(args.state ?? join(base, "state", "seen.json"));
  const seen = args.cmd === "run" ? loadSeen(statePath) : null;
  const starsPath = join(dirname(statePath), "stars.json");
  const stars = loadStars(starsPath);
  // The revival radar runs in discover mode only, so the two weekly runs do not pay for it twice.
  const revivalPath = join(dirname(statePath), "revival.json");
  const revivalState = cfg.revival.enabled && cfg.mode === "discover" ? loadRevival(revivalPath) : null;
  if (revivalState?.problems.length) console.error(`warning: ${revivalState.problems.length} revival state problems, first: ${revivalState.problems[0]}`);
  const fb = loadFeedback(resolve(args.feedback ?? join(base, "feedback.yml")));
  for (const p of fb.problems) console.error(`warning: ${p}`);
  if (fb.marks.length) log(`feedback: ${fb.marks.length} marks`);
  let res: ForageResult;
  try {
    // The personalization catalog is built by `run` in discover mode only (the Discover page uses it).
    const catalog = args.cmd === "run" && cfg.mode === "discover" && cfg.site.personalize.enabled;
    res = await forage(cfg, gh, { skip: seen ? seenKeys(seen) : undefined, log, stars, feedback: fb.marks, catalog, revival: revivalState?.state ?? false });
  } catch (e) {
    if (e instanceof RateLimitError) { console.error(`gitforage: ${e.message}`); return 1; }
    throw e;
  }
  let llmNote = "";
  if (cfg.llm.provider !== "none") {
    const cacheDir = args.noCache ? null : join(resolve(args.cacheDir ?? join(base, ".gitforage", "cache")), "llm");
    const r = await llmRerank(res.ranked, cfg, { env, cacheDir, log });
    res.warnings.push(...r.warnings);
    if (r.applied) llmNote = ` The top ${cfg.llm.top} were also judged by an AI model (llm.provider ${cfg.llm.provider}); its fit counts at most ${cfg.llm.weight} points either way.`;
  }
  const items = res.ranked.slice(0, args.limit ?? cfg.digest_size);
  for (const w of res.warnings) console.error(`warning: ${w}`);
  if (args.debug) for (const e of res.excluded) console.error(`dropped ${e.full_name}: ${cleanText(e.reason, 300)}`);

  const note = `Mode: ${cfg.mode}. Scores are rule-based; each line lists its reasons.${llmNote}`;
  const rendered = () => (args.json ? JSON.stringify(toJson(items), null, 2) + "\n" : toMarkdown(items, { note }));
  if (args.cmd === "preview") {
    if (args.out) { writeFileSync(args.out, rendered()); log(`wrote ${args.out}`); }
    else console.log(args.json ? JSON.stringify(toJson(items), null, 2) : toText(items) || "No candidates found.");
    if (!args.json && res.revival?.length) console.log(`\n${revivalText(res.revival)}`);
  } else {
    if (args.out) writeFileSync(args.out, rendered());
    else process.stdout.write(rendered());
    saveSeen(statePath, markSeen(seen!, items.map((s) => ({ full_name: s.candidate.repo.full_name, score: s.score })), Date.now()));
    saveStars(starsPath, stars);
    const now = new Date();
    saveDigest(join(dirname(statePath), "digests"), {
      version: 1, date: isoDate(now.getTime()), mode: cfg.mode, generated_at: now.toISOString(), items: toDigestItems(items),
    });
    if (res.catalog) {
      const sel = selectCatalog(toCatalogItems(res.catalog, cfg, now.getTime()), catalogTopics(cfg), cfg.site.personalize.per_topic);
      saveCatalog(join(dirname(statePath), "catalog.json"), { version: 1, generated_at: now.toISOString(), items: sel.items });
      log(`catalog: ${sel.items.length} of ${res.catalog.length} candidates kept (${sel.per_topic} per topic at most)`);
    }
    if (revivalState && res.revival) {
      saveRevival(revivalPath, revivalState.state);
      log(`revival: ${res.revival.length} revivals recorded in ${revivalPath}`);
    }
    log(`recorded ${items.length} items in ${statePath}${args.out ? `; wrote ${args.out}` : ""}`);
  }
  if (!args.quiet) console.error(stats(gh, started, res));
  return 0;
}

const stateDir = (args: Args, base: string) => dirname(resolve(args.state ?? join(base, "state", "seen.json")));

function site(args: Args, cfg: Config, base: string, log: (m: string) => void): number {
  if (!args.out) { console.error("gitforage: site needs --out DIR"); return 2; }
  const { digests, problems } = loadDigests(join(stateDir(args, base), "digests"));
  for (const p of problems) console.error(`warning: ${p}`);
  let catalog: CatalogState | null = null;
  if (cfg.site.personalize.enabled) {
    const loaded = loadCatalog(join(stateDir(args, base), "catalog.json"), new Set(catalogTopics(cfg)));
    // Items that fail validation are dropped; report the count, not every one.
    if (loaded.problems.length) console.error(`warning: ${loaded.problems.length} catalog problems, first: ${loaded.problems[0]}`);
    catalog = loaded.catalog;
  }
  let revival: RevivalItem[] | null = null;
  if (cfg.revival.enabled) {
    const loaded = loadRevival(join(stateDir(args, base), "revival.json"));
    if (loaded.problems.length) console.error(`warning: ${loaded.problems.length} revival problems, first: ${loaded.problems[0]}`);
    revival = loaded.state.items;
  }
  const files = renderSite(cfg, digests, { repo: args.repo ?? null, catalog, revival, haulNotes: loadHaulNotes(join(base, "haul.txt")) });
  const n = writeSite(args.out, new Map<string, string | Uint8Array>([...files, ...siteBinaries()]));
  log(`site: ${digests.length} digests, wrote ${n} files to ${args.out}`);
  return 0;
}

/** haul.txt next to the config: optional one-line notes for Haul issues. Missing is fine. */
function loadHaulNotes(path: string): Map<number, string> | null {
  try {
    if (statSync(path).size > MAX_HAUL_NOTES_BYTES) { console.error("warning: haul.txt is larger than 64 KB, ignored"); return null; }
    const { notes, problems } = parseHaulNotes(readFileSync(path, "utf8"));
    for (const p of problems.slice(0, 5)) console.error(`warning: ${p}`);
    return notes;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Most bytes read from an intake JSON input. */
const MAX_INTAKE_BYTES = 5 * 1024 * 1024;

function readJsonInput(text: string, what: string): unknown {
  if (text.length > MAX_INTAKE_BYTES) throw new UsageError(`${what} is larger than 5 MB`);
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${what} is not valid JSON`);
  }
}

async function feedback(args: Args, cfg: Config, base: string, env: Record<string, string | undefined>, log: (m: string) => void): Promise<number> {
  const inputs: unknown[] = [];
  try {
    if (args.event) inputs.push(readJsonInput(readFileSync(args.event, "utf8"), args.event));
    if (args.issues) inputs.push(readJsonInput(readFileSync(args.issues, "utf8"), args.issues));
    if (!inputs.length && env.GITFORAGE_ISSUES_JSON) inputs.push(readJsonInput(env.GITFORAGE_ISSUES_JSON, "GITFORAGE_ISSUES_JSON"));
  } catch (e) {
    console.error(`gitforage: ${(e as Error).message}`);
    return 2;
  }
  if (!inputs.length) { console.error("gitforage: feedback needs --event FILE, --issues FILE or GITFORAGE_ISSUES_JSON"); return 2; }
  const issues = issuesFrom(...inputs);
  const fbPath = resolve(args.feedback ?? join(base, "feedback.yml"));
  const current = loadFeedback(fbPath);
  if (current.problems.length) {
    console.error(`gitforage: not changing ${fbPath}: ${current.problems[0]}`);
    return 1;
  }
  const { digests, problems } = loadDigests(join(stateDir(args, base), "digests"));
  for (const p of problems) console.error(`warning: ${p}`);
  const gh = new GitHub({
    token: tokenFromEnv(env),
    cacheDir: args.noCache ? null : resolve(args.cacheDir ?? join(base, ".gitforage", "cache")),
    ttlMs: cfg.cache.ttl_hours * 3_600_000,
    log,
  });
  const outcomes = await intake(issues, {
    feedback: cfg.feedback,
    now: Date.now(),
    existing: current.marks,
    digests,
    accountCreatedAt: async (login) => {
      if (!isSafeLogin(login)) return null;
      const u = await gh.get<any>(`/users/${login}`, { allow: [404] });
      return typeof u?.created_at === "string" ? u.created_at : null;
    },
    repoFacts: async (full) => {
      if (!isSafeFullName(full)) return null;
      const r = toRepo(await gh.get<any>(`/repos/${full}`, { allow: [404, 451] }));
      return r ? { full_name: r.full_name, topics: r.topics, language: r.language } : null;
    },
  });
  const added = outcomes.flatMap((o) => (o.status === "accepted" ? [o.mark] : []));
  if (added.length) appendFeedback(fbPath, added);
  if (args.replies) {
    mkdirSync(args.replies, { recursive: true });
    for (const o of outcomes) writeFileSync(join(args.replies, `${o.number}.md`), replyFor(o));
  }
  if (args.json) console.log(JSON.stringify(outcomes, null, 2));
  else for (const o of outcomes) log(`#${o.number}: ${o.status === "accepted" ? `recorded ${o.mark.mark} ${o.mark.repo} (${o.mark.from})` : `not recorded: ${o.reason}`}`);
  log(`feedback: ${issues.length} issues read, ${outcomes.length} handled, ${added.length} marks added`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => {
    console.error(`gitforage: ${(e as Error).message}`);
    process.exit(1);
  });
}
