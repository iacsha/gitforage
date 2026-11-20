import { describe, expect, test } from "bun:test";
import { GitHub, affinityOf, profileCounts, profileFrom, readmeText, termFrequency, termPairs, termsOf, tokens } from "../src/index.ts";
import { fakeApi, fakeClock, json, repo } from "./helpers.ts";

const stars = (list: [string, string[], string?][]) =>
  list.map(([full, topics, description = ""]) => ({ repo: repo(full, { topics, description }), weight: 1 }));

describe("profile terms", () => {
  test("tokens: lowercase words, no stopwords, numbers or markup", () => {
    expect(tokens("A simple HL7 v2 MLLP <b>listener</b> for Mirth-Connect, written in C++ (2024)!")).toEqual(
      ["hl7", "v2", "mllp", "listener", "mirth-connect", "c++"],
    );
    expect(tokens("https://github.com/x/y")).toEqual(["x", "y"].filter((t) => t.length >= 2));
    for (const t of tokens("‮<script>alert(1)</script>\u0000\x1b[31m javascript:void(0)")) expect(t).toMatch(/^[a-z0-9][a-z0-9+#-]*$/);
  });

  test("a repo's terms are its topics plus name and description words", () => {
    expect([...termsOf(repo("acme/hl7-relay", { topics: ["hl7", "Bad Topic!"], description: "Relays FHIR bundles" }))].sort())
      .toEqual(["bundles", "fhir", "hl7", "relay", "relays"]);
  });

  test("counts need two repos of support; seeds weigh double", () => {
    const c = profileCounts([
      ...stars([["a/1", ["hl7", "solo"]], ["a/2", ["hl7"]]]),
      { repo: repo("s/seed", { topics: ["hl7", "only-seed"] }), weight: 2 },
    ], 10);
    expect([...c.tf]).toEqual([["hl7", 4]]);
    expect(c.size).toBe(4);
  });

  test("weights: rare-on-GitHub terms beat common ones at the same frequency", () => {
    const counts = profileCounts(stars([
      ["a/1", ["hl7", "docker"]], ["a/2", ["hl7", "docker"]], ["a/3", ["docker"]], ["a/4", ["fhir"]], ["a/5", ["fhir"]],
    ]), 10);
    const p = profileFrom(counts, new Map([["hl7", 3_000], ["docker", 2_000_000], ["fhir", 5_000]]));
    expect(p.terms.map((t) => t.term)).toEqual(["hl7", "fhir", "docker"]);
    expect(p.terms[0].weight).toBe(1);
    expect(p.weights.get("docker")!).toBeLessThan(p.weights.get("hl7")!);
    // A term with no GitHub count is left out rather than guessed.
    expect(profileFrom(counts, new Map([["hl7", 3_000]])).terms.map((t) => t.term)).toEqual(["hl7"]);
  });

  test("affinity sums the weights of the profile terms a repo carries (top 5)", () => {
    const p = profileFrom(profileCounts(stars([["a/1", ["hl7", "mllp"]], ["a/2", ["hl7", "mllp"]]]), 10), new Map([["hl7", 3000], ["mllp", 200]]));
    const a = affinityOf(repo("x/y", { topics: ["mllp"], description: "HL7 tools" }), p);
    expect(a.shared).toEqual(["mllp", "hl7"]);
    expect(a.fit).toBeCloseTo(1 + p.weights.get("hl7")!, 3);
    expect(affinityOf(repo("x/viral", { description: "AI writing app" }), p)).toEqual({ shared: [], fit: 0 });
  });

  test("term pairs: co-occurring, no near-duplicates, each term in at most 3 pairs", () => {
    const list: [string, string[]][] = [];
    for (let i = 0; i < 3; i++) list.push([`a/${i}`, ["smart-home", "home-assistant", "home", "zigbee", "mqtt", "matter", "esphome"]]);
    const p = profileFrom(profileCounts(stars(list), 20), new Map(["smart-home", "home-assistant", "home", "zigbee", "mqtt", "matter", "esphome"].map((t, i) => [t, 1000 * (i + 1)])));
    const pairs = termPairs(p, 20);
    expect(pairs.some(([a, b]) => (a === "home" && b === "home-assistant") || (a === "home-assistant" && b === "home"))).toBe(false);
    const uses = new Map<string, number>();
    for (const [a, b] of pairs) for (const t of [a, b]) uses.set(t, (uses.get(t) ?? 0) + 1);
    for (const n of uses.values()) expect(n).toBeLessThanOrEqual(3);
  });

  test("term frequency: one search per term, refusing anything not token-shaped", async () => {
    const api = fakeApi([[/^\/search\/repositories/, () => json({ total_count: 4321, items: [] })]]);
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    expect(await termFrequency(gh, "hl7")).toBe(4321);
    expect(await termFrequency(gh, 'x" OR stars:>1')).toBeNull();
    expect(await termFrequency(gh, "../etc")).toBeNull();
    expect(api.calls).toEqual(['/search/repositories?q="hl7"&per_page=1']);
  });

  test("README text is decoded and capped; odd payloads give null", async () => {
    const big = Buffer.from("hl7 ".repeat(50_000)).toString("base64");
    const api = fakeApi([
      [/^\/repos\/a\/big\/readme$/, () => json({ encoding: "base64", content: big })],
      [/^\/repos\/a\/odd\/readme$/, () => json({ encoding: "utf8", content: "x" })],
    ]);
    const gh = new GitHub({ fetch: api.fetch, ...fakeClock() });
    expect((await readmeText(gh, "a/big"))!.length).toBe(40_000);
    expect(await readmeText(gh, "a/odd")).toBeNull();
    expect(await readmeText(gh, "a/missing")).toBeNull();
  });
});

describe("README words", () => {
  test("strengthen a term the topics already show, but never introduce one", () => {
    const c = profileCounts([
      { repo: repo("s/one", { topics: ["mllp"] }), readme: "Getting started: install. MLLP listener. Unrelated words here.", weight: 2 },
      { repo: repo("s/two", { topics: ["mllp"] }), readme: "MLLP listener. Unrelated words here.", weight: 2 },
    ], 10);
    expect([...c.tf.keys()]).toEqual(["mllp"]);
    expect(c.tf.get("mllp")).toBe(4);
  });

  test("event and label topics such as hacktoberfest stay out of the profile", () => {
    const r = repo("a/b", { topics: ["hacktoberfest", "hacktoberfest2023", "good-first-issue", "hl7", "open-source"] });
    expect([...termsOf(r)]).toEqual(["hl7"]);
  });
});
