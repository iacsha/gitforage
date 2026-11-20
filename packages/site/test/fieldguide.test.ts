// The field-guide identity: field notes, tree rings, the forage map, the labels and the font.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateConfig, type Digest, type DigestItem } from "@gitforage/core";
import { csp, esc, renderSite } from "../src/index.ts";
import { fieldNote, noteHash } from "../assets/fieldnote.js";
import { ringShapes, ringSpec, ringWords, RING_STATES } from "../assets/rings.js";
import { FIELD_NOTE, SOURCE_LABELS, STRINGS } from "../assets/strings.js";

const NOW = "2026-11-22T12:00:00.000Z";
const assets = join(import.meta.dir, "..", "assets");
const HOSTILE = `<img src=x onerror="alert(1)"> {age} ‮evil "quoted" javascript:alert(2) & secret-word`;

function item(full: string, o: Partial<DigestItem> = {}): DigestItem {
  return {
    full_name: full, url: `https://github.com/${full}`, score: 10, stars: 120, language: "Rust", description: "A tool",
    sources: ["search"], reasons: [{ rule: "topic_match", points: 3, text: "your topic hl7" }], topics: ["hl7"], via_topics: [],
    created_at: "2026-10-01T00:00:00.000Z", pushed_at: "2026-11-20T00:00:00.000Z", lang: "en", health: null, ...o,
  };
}
const digest = (mode: "discover" | "contribute", items: DigestItem[]): Digest =>
  ({ version: 1, date: "2026-11-22", mode, generated_at: "2026-11-22T06:00:00.000Z", items });
const config = (topics = ["hl7", "fhir"]) => validateConfig({ topics, profile: "Tools.", site: { repo: "acme/portal", title: "Acme portal" } });

/** A repo name whose hash picks opener i (and source template j when given). */
function nameFor(i: number, j?: number, n = 3): string {
  for (let k = 0; k < 100000; k++) {
    const name = `o/r${k}`;
    const h = noteHash(name);
    if (h % FIELD_NOTE.openers.length === i && (j === undefined || (h >>> 4) % n === j)) return name;
  }
  throw new Error("no name");
}

describe("field notes", () => {
  test("never carry untrusted text: the description is not an input; bad language and off-list topics are dropped", () => {
    const note = fieldNote({ name: "evil/repo", language: `<svg onload=x>`, topics: ["secret-word", "hl7", `"><b>`], allowed: ["hl7"], years: 2, growth: 3, sources: ["rising"] });
    expect(note).not.toContain("svg");
    expect(note).not.toContain("secret-word");
    expect(note).not.toContain("evil");
    expect(note).toMatch(/^[A-Za-z0-9 ,.:'-]+$/);
    // A hostile description changes nothing on the card's note, and never reaches it.
    const page = (description: string) => renderSite(config(), [digest("discover", [item("evil/repo", { description, language: "<b>x</b>" })])], { now: NOW }).get("index.html")!;
    const notes = (body: string) => [...body.matchAll(/<p class="note">([^<]*)<\/p>/g)].map((m) => m[1]);
    expect(notes(page(HOSTILE))).toEqual(notes(page("A tool")));
    for (const n of notes(page(HOSTILE))) for (const w of ["secret-word", "evil", "onerror", "javascript", "{age}", "<b>"]) expect(n).not.toContain(w);
  });

  test("every template renders with every field missing, and with every field present", () => {
    for (let i = 0; i < FIELD_NOTE.openers.length; i++) {
      for (const o of [{ name: nameFor(i) }, { name: nameFor(i), language: "Go", topics: ["cli"], allowed: ["cli"], years: 5, growth: 2, sources: ["kin"],
        health: { outside_prs_90d: 1, issue_response: { answered: 2, total: 3 } } }]) {
        const note = fieldNote(o);
        expect(note).not.toMatch(/[{}]|undefined|null|NaN|\s{2}|\s[,.:]/);
        expect(note).toMatch(/^[A-Z].*\.$/);
      }
    }
    for (const src of ["search", "rising", "fork", "kin"] as const) {
      FIELD_NOTE.sources[src].forEach((t, j) => {
        const note = fieldNote({ name: nameFor(0, j, FIELD_NOTE.sources[src].length), sources: [src], growth: 1 });
        expect(note).toContain(t.replace("{growth}", FIELD_NOTE.growth[1]));
      });
    }
    expect(fieldNote({ name: "a/b", health: { outside_prs_90d: 1 } })).toContain("1 outside pull request merged");
    expect(fieldNote({ name: "a/b", health: { outside_prs_90d: Number.NaN, issue_response: { answered: 9, total: 3 } } })).not.toMatch(/Tended|answered/);
  });

  test("the choice is stable per repo and varied across repos", () => {
    const o = { name: "acme/tool", language: "Rust", topics: ["cli"], allowed: ["cli"], years: 1, growth: 2, sources: ["rising"] };
    expect(fieldNote(o)).toBe(fieldNote({ ...o }));
    expect(noteHash("acme/tool")).toBe(noteHash("acme/tool"));
    const openers = new Set(Array.from({ length: 40 }, (_, k) => fieldNote({ name: `x/y${k}` }).split(".")[0]));
    expect(openers.size).toBeGreaterThanOrEqual(4);
  });

  test("the rendered note is escaped", () => {
    const name = nameFor(0, 1, FIELD_NOTE.sources.kin.length); // "Close kin to the guide's favourite finds."
    const body = renderSite(config(), [digest("discover", [item(name, { sources: ["kin"] })])], { now: NOW }).get("index.html")!;
    const note = /<p class="note">([^<]*)<\/p>/.exec(body)![1];
    expect(note).toContain("guide&#39;s");
    expect(note).not.toContain("'");
    expect(esc(fieldNote({ name, language: "Rust", topics: ["hl7"], allowed: ["hl7", "fhir"], years: 1, growth: 0, sources: ["kin"] }))).toBe(note);
  });
});

describe("tree rings", () => {
  test("buckets age, recency and momentum, and draws only formatted numbers and fixed classes", () => {
    expect(ringSpec("2020-01-01T00:00:00Z", "2026-11-21T00:00:00Z", NOW, 4)).toEqual({ years: 5, state: "fresh", growth: 3 });
    expect(ringSpec("2026-10-01T00:00:00Z", "2026-06-01T00:00:00Z", NOW, 0)).toEqual({ years: 1, state: "dormant", growth: 0 });
    expect(ringSpec("bad", "bad", "bad", Number.NaN)).toEqual({ years: 1, state: "dormant", growth: 0 });
    for (const state of [...RING_STATES, "<x>"]) for (const years of [0, 1, 3, 99, Number.NaN]) for (const growth of [-1, 0, 2, 9]) {
      for (const c of ringShapes({ years, state, growth })) {
        for (const v of [c.cx, c.cy, c.r, c.w]) expect(v).toMatch(/^\d{1,2}\.\d{2}$/);
        expect(c.cls).toMatch(/^ring-(pith|year|growth ring-(fresh|recent|quiet|dormant))$/);
      }
    }
    expect(ringWords({ years: 2, state: "recent", growth: 1 })).toBe("Tree ring: about a year old, growing this month, a few new stars");
  });
});

describe("forage map", () => {
  test("draws the portal's own patches as linked hills, only with three or more", () => {
    const items = [item("a/one", { topics: ["hl7", "fhir"] }), item("b/two", { topics: ["dicom", "hl7"] }), item("c/three", { topics: ["fhir"] })];
    const body = renderSite(config(["hl7", "fhir", "dicom"]), [digest("discover", items)], { now: NOW }).get("index.html")!;
    expect(body).toContain('<figure class="forage-map" aria-labelledby="forage-map-title">');
    const hills = [...body.matchAll(/<a class="hill" href="([^"]+)" data-map-topic="([^"]+)" aria-label="([^"]+)">/g)].map((m) => m.slice(1));
    expect(hills).toEqual([["topics/hl7.html", "hl7", "hl7: 2 finds"], ["topics/fhir.html", "fhir", "fhir: 2 finds"], ["topics/dicom.html", "dicom", "dicom: 1 find"]]);
    expect(renderSite(config(), [digest("discover", items)], { now: NOW }).get("index.html")).not.toContain("forage-map");
    const site = readFileSync(join(assets, "site.js"), "utf8");
    expect(site).toContain('if (chips[i].getAttribute("data-value") === value) {');
  });
});

describe("labels and voice", () => {
  test("only display labels changed: source values, URL params and feedback titles stay", () => {
    const body = renderSite(config(), [digest("discover", [item("a/one", { sources: ["search", "rising", "fork", "kin"] })])], { now: NOW }).get("index.html")!;
    for (const s of ["search", "rising", "fork", "kin"] as const) expect(body).toContain(`>${SOURCE_LABELS[s].label}</`);
    expect(body).toContain('data-sources="search rising fork kin"');
    expect(body).toContain('data-filter="source" data-value="search"');
    expect(body).toContain("title=keep%3A%20a%2Fone");
    expect(body).toContain(`<h1>${esc(STRINGS.discoverTitle)}</h1>`);
  });

  test("the voice has no em dashes", () => {
    for (const f of ["strings.js", "fieldnote.js", "rings.js"]) expect(readFileSync(join(assets, f), "utf8")).not.toContain("—");
    const about = renderSite(config(), [], { now: NOW }).get("about.html")!;
    expect(about).not.toContain("—");
  });
});

describe("the heading font", () => {
  test("is self-hosted, small, licensed, and matches its recorded hash; CSP adds font-src 'self' only", () => {
    const font = readFileSync(join(assets, "fonts", "fraunces-fieldguide.woff2"));
    expect(font.subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(font.length).toBeLessThan(60 * 1024);
    const source = readFileSync(join(assets, "fonts", "SOURCE.md"), "utf8");
    expect(source).toContain(createHash("sha256").update(font).digest("hex"));
    expect(readFileSync(join(assets, "fonts", "OFL.txt"), "utf8")).toContain("SIL Open Font License, Version 1.1");
    const css = readFileSync(join(assets, "site.css"), "utf8");
    expect([...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]).sort()).toEqual(["fonts/fraunces-fieldguide.woff2", "paper-night.svg", "paper-night.svg", "paper.svg"]);
    expect(csp(config().site)).toContain("font-src 'self';");
    expect(csp(config().site)).not.toMatch(/font-src [^;]*(https?:|data:|\*)/);
  });
});
