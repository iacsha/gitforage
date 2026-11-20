import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { exclusionReason, loadConfig } from "../src/index.ts";
import { cand } from "./helpers.ts";

describe("the demo portal's catalog", () => {
  const demo = loadConfig(join(import.meta.dir, "..", "..", "..", "demo", "interests.yml"));
  const p = demo.site.personalize;

  test("is on, with 60 to 100 topics in groups and 8 to 12 starter packs; the default view keeps its topics", () => {
    expect(p.enabled).toBe(true);
    expect(p.topics.length).toBeGreaterThanOrEqual(60);
    expect(p.topics.length).toBeLessThanOrEqual(100);
    expect(p.packs.length).toBeGreaterThanOrEqual(8);
    expect(p.packs.length).toBeLessThanOrEqual(12);
    expect(p.groups.map((g) => g.name)).not.toContain("More topics");
    expect(demo.topics).toEqual(["hl7", "fhir", "mirth", "dicom", "proxmox", "self-hosted", "docker", "home-assistant", "zigbee", "matter",
      "cli", "terminal", "devtools", "claude-code", "mcp", "ai-agents"]);
    for (const t of demo.topics) expect(p.topics).toContain(t);
    expect(demo.filters.spoken_languages).toEqual(["en"]);
    expect(demo.filters.drop_suspected_star_farms).toBe(true);
  });

  test("has no IPTV, M3U or XMLTV topics anywhere, and excludes them explicitly", () => {
    const tv = /iptv|m3u|xmltv|epg/;
    expect(p.topics.filter((t) => tv.test(t))).toEqual([]);
    for (const k of p.packs) expect(k.topics.filter((t) => tv.test(t))).toEqual([]);
    for (const t of ["iptv", "m3u", "m3u8", "xmltv"]) expect(demo.exclude.topics).toContain(t);
    for (const t of ["awesome-list", "awesome"]) expect(demo.exclude.topics).toContain(t);
    const r = cand("x/tv", {}, { description: "A tiny IPTV player for M3U8 playlists", topics: ["video"] });
    expect(exclusionReason(r, demo, new Set())).toMatch(/^excluded regex/);
    expect(exclusionReason(cand("x/tv2", {}, { description: "Guide data in XMLTV format" }), demo, new Set())).toMatch(/^excluded regex/);
    expect(exclusionReason(cand("x/ok", {}, { description: "A fast terminal emulator" }), demo, new Set())).toBeNull();
  });
});
