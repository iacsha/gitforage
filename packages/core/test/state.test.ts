import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emptySeen, loadSeen, markSeen, saveSeen, seenKeys } from "../src/index.ts";
import { NOW } from "./helpers.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "gitforage-state-"));

describe("seen state", () => {
  test("a missing file is an empty state", () => {
    expect(loadSeen(join(tmp(), "nope", "seen.json"))).toEqual(emptySeen());
  });

  test("round-trips, creates the folder, and keys are lowercase", () => {
    const p = join(tmp(), "state", "seen.json");
    saveSeen(p, markSeen(emptySeen(), [{ full_name: "Acme/Thing", score: 12.5 }], NOW));
    const s = loadSeen(p);
    expect(s.seen["acme/thing"]).toEqual({ first_seen: "2026-11-20T12:00:00.000Z", score: 12.5 });
    expect(seenKeys(s).has("acme/thing")).toBe(true);
  });

  test("marking again keeps the first_seen date", () => {
    const s = markSeen(emptySeen(), [{ full_name: "a/b", score: 1 }], NOW);
    markSeen(s, [{ full_name: "A/B", score: 9 }], NOW + 86_400_000);
    expect(s.seen["a/b"]).toEqual({ first_seen: "2026-11-20T12:00:00.000Z", score: 1 });
  });

  test("output is sorted for clean git diffs", () => {
    const p = join(tmp(), "seen.json");
    saveSeen(p, markSeen(emptySeen(), [{ full_name: "z/z", score: 1 }, { full_name: "a/a", score: 1 }], NOW));
    const keys = Object.keys(JSON.parse(readFileSync(p, "utf8")).seen);
    expect(keys).toEqual(["a/a", "z/z"]);
  });

  test("a foreign file is rejected rather than overwritten", () => {
    const p = join(tmp(), "seen.json");
    writeFileSync(p, JSON.stringify({ hello: "world" }));
    expect(() => loadSeen(p)).toThrow("not a gitforage seen-state file");
  });
});
