// state/seen.json: what has already been reported, so `run` only carries new items.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SeenEntry { first_seen: string; score: number }
export interface SeenState { version: 1; seen: Record<string, SeenEntry> }

export const emptySeen = (): SeenState => ({ version: 1, seen: {} });

export function loadSeen(path: string): SeenState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptySeen();
    throw e;
  }
  const data = JSON.parse(text);
  if (data?.version !== 1 || typeof data.seen !== "object" || data.seen === null) {
    throw new Error(`${path} is not a gitforage seen-state file (expected {"version": 1, "seen": {...}})`);
  }
  return data as SeenState;
}

export const seenKeys = (s: SeenState) => new Set(Object.keys(s.seen).map((k) => k.toLowerCase()));

/** Record items as seen. Existing entries keep their first_seen date. */
export function markSeen(s: SeenState, items: { full_name: string; score: number }[], now: number): SeenState {
  const date = new Date(now).toISOString();
  for (const it of items) {
    const key = it.full_name.toLowerCase();
    if (!s.seen[key]) s.seen[key] = { first_seen: date, score: it.score };
  }
  return s;
}

/** Write atomically (temp file, then rename) so a crash cannot leave half a file. */
export function saveSeen(path: string, s: SeenState) {
  mkdirSync(dirname(path), { recursive: true });
  const sorted: SeenState = { version: 1, seen: Object.fromEntries(Object.entries(s.seen).sort(([a], [b]) => a.localeCompare(b))) };
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(sorted, null, 2) + "\n");
  renameSync(tmp, path);
}
