// `gitforage early-finds`: the daily update of state/early-finds.json (see core/earlyfinds.ts).

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { GitHub, loadEarlyFinds, loadSeen, saveEarlyFinds, tokenFromEnv, updateEarlyFinds, type Config, type EarlyFindsLedger, type WebFetch } from "@gitforage/core";

export interface EarlyFindsArgs { state?: string; cacheDir?: string; noCache: boolean }

export async function earlyFindsCommand(
  args: EarlyFindsArgs, cfg: Config, base: string, env: Record<string, string | undefined>, log: (m: string) => void,
): Promise<number> {
  if (!cfg.early_finds.enabled) { log("early finds: early_finds.enabled is false in the config; nothing to do"); return 0; }
  const seenPath = resolve(args.state ?? join(base, "state", "seen.json"));
  if (!existsSync(seenPath)) { log(`early finds: no seen state at ${seenPath} yet (gitforage run makes it); nothing to track`); return 0; }
  const seen = loadSeen(seenPath);
  const ledgerPath = join(dirname(seenPath), "early-finds.json");
  const { ledger, problems } = loadEarlyFinds(ledgerPath);
  if (problems.length) console.error(`warning: ${problems.length} early-finds problems, first: ${problems[0]}`);
  if (!Object.keys(seen.seen).length && !Object.keys(ledger.repos).length) { log("early finds: nothing has been shown yet; nothing to track"); return 0; }

  const token = tokenFromEnv(env);
  if (!token) log("no GITHUB_TOKEN or GH_TOKEN set: limited to 60 requests an hour, so fewer star checks");
  const gh = new GitHub({
    token,
    cacheDir: args.noCache ? null : resolve(args.cacheDir ?? join(base, ".gitforage", "cache")),
    ttlMs: cfg.cache.ttl_hours * 3_600_000,
    log,
  });
  const run = await updateEarlyFinds(gh, seen, ledger, Date.now(), ((u, i) => fetch(u, i)) as WebFetch);
  for (const w of run.warnings) console.error(`warning: ${gh.redact(w)}`);
  saveEarlyFinds(ledgerPath, ledger);
  log(`early finds: tracking ${run.tracked} (+${run.added}); Trending today ${run.trendingToday ?? "skipped"} (new hits ${run.trendingHits}); ` +
    `HN new hits ${run.hnHits}; stars checked ${run.checked}, milestones crossed ${run.crossed}; wrote ${ledgerPath}`);
  return 0;
}

/** For `site`: the ledger beside the seen state when early_finds is on (validated again at build). */
export function earlyFindsForSite(cfg: Config, stateDir: string): EarlyFindsLedger | null {
  if (!cfg.early_finds.enabled) return null;
  const { ledger, problems } = loadEarlyFinds(join(stateDir, "early-finds.json"));
  if (problems.length) console.error(`warning: ${problems.length} early-finds problems, first: ${problems[0]}`);
  return ledger;
}
