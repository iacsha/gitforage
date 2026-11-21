#!/usr/bin/env bun
// One-off migration: convert the early-finds prototype's ledger into state/early-finds.json.
//
//   bun scripts/import-early-finds.ts <old ledger.json> <out state/early-finds.json>
//
// The prototype keyed repos by lowercase owner/repo with first_seen, stars_at_first_seen,
// trending_first, hn_first {date, id, points}, milestones, stars_last and checked. The new
// file adds tracked_since, the first day the ledger watched a repo. The prototype did not
// record it, so it is the later of the day the repo was first shown and the day the
// prototype started (its earliest check): signals on or before that day are not credited.
// Every entry is validated like any ledger read from disk; bad ones are dropped and counted.

import { readFileSync } from "node:fs";
import { earlyFinds, isoDate, MAX_LEDGER_BYTES, saveEarlyFinds, toIsoTime, validateEarlyFinds, type EarlyFindsLedger } from "../packages/core/src/index.ts";

export interface ImportResult { ledger: EarlyFindsLedger; read: number; dropped: string[]; start: string | null }

export function importPrototype(data: unknown): ImportResult {
  const d = data as { version?: unknown; updated?: unknown; repos?: unknown } | null;
  if (typeof d !== "object" || d === null || d.version !== 1 || typeof d.repos !== "object" || d.repos === null || Array.isArray(d.repos)) {
    throw new Error('not a prototype ledger (expected {"version": 1, "repos": {...}})');
  }
  const entries = Object.entries(d.repos as Record<string, unknown>);
  let start: string | null = null;
  for (const [, v] of entries) {
    const c = toIsoTime((v as { checked?: unknown } | null)?.checked);
    if (c && (!start || c.slice(0, 10) < start)) start = c.slice(0, 10);
  }
  const repos: Record<string, unknown> = {};
  for (const [name, v] of entries) {
    if (typeof v !== "object" || v === null || Array.isArray(v)) { repos[name] = null; continue; }
    const o = v as Record<string, unknown>;
    const shown = toIsoTime(o.first_seen);
    const shownDay = shown ? shown.slice(0, 10) : null;
    const tracked_since = shownDay && start ? (shownDay > start ? shownDay : start) : shownDay ?? start ?? undefined;
    repos[name] = {
      first_seen: o.first_seen, tracked_since, stars_at_first_seen: o.stars_at_first_seen, trending_first: o.trending_first, trending_from: tracked_since, hn_from: tracked_since,
      hn_first: o.hn_first, milestones: o.milestones, stars_last: o.stars_last, checked: o.checked,
    };
  }
  const { ledger, problems } = validateEarlyFinds({ version: 1, updated: d.updated, repos }, "prototype ledger");
  return { ledger, read: entries.length, dropped: problems, start };
}

if (import.meta.main) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error("usage: bun scripts/import-early-finds.ts <old ledger.json> <out state/early-finds.json>"); process.exit(2); }
  const text = readFileSync(src, "utf8");
  if (text.length > MAX_LEDGER_BYTES) { console.error("the old ledger is larger than 16 MB; refusing"); process.exit(1); }
  const r = importPrototype(JSON.parse(text));
  if (!r.ledger.updated) r.ledger.updated = new Date().toISOString();
  saveEarlyFinds(out, r.ledger);
  const all = Object.values(r.ledger.repos);
  const finds = earlyFinds(r.ledger);
  console.log(`read ${r.read}, imported ${all.length}, dropped ${r.dropped.length}; tracking since ${r.start ?? "unknown"}`);
  console.log(`with trending_first ${all.filter((e) => e.trending_first).length}, hn_first ${all.filter((e) => e.hn_first).length}, ` +
    `milestones ${all.filter((e) => e.milestones).length}, checked ${all.filter((e) => e.checked).length}, gone ${all.filter((e) => e.stars_last === -1).length}`);
  console.log(`qualifying early finds (lead of a day or more) as of ${isoDate(Date.now())}: ${finds.length}`);
  for (const p of r.dropped.slice(0, 10)) console.log(`  ${p}`);
  console.log(`wrote ${out}`);
}
