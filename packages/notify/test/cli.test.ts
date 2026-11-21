// `gitforage notify` end to end, with the global fetch replaced: no network.

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseArgs, UsageError } from "../../cli/src/cli.ts";

// Fake, built at runtime so secret scanners do not mistake the fixture for a real bot token.
const BOT = ["123456789", "AAH-" + "abcdefghijklmnopqrstuvwxyz_0123"].join(":");
const ENV = { GITFORAGE_TELEGRAM_BOT_TOKEN: BOT, GITFORAGE_TELEGRAM_CHAT_ID: "42" };

describe("gitforage notify", () => {
  const realFetch = globalThis.fetch;
  let dir: string, calls: string[], out: string[], err: string[], spies: { mockRestore(): void }[];

  const setup = (notify: string, date = "2026-11-22") => {
    writeFileSync(join(dir, "interests.yml"), `topics: [hl7]\nsite: { repo: me/portal }\n${notify}\n`);
    mkdirSync(join(dir, "state", "digests"), { recursive: true });
    writeFileSync(join(dir, "state", "digests", `${date}-discover.json`), JSON.stringify({
      version: 1, items: [{ full_name: "a/b", score: 30, stars: 9, reasons: [{ rule: "topic_match", points: 6, text: "1 of your topics" }] }],
    }));
  };
  const run = (...flags: string[]) => main(["notify", "--config", join(dir, "interests.yml"), ...flags], ENV);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "gitforage-notify-"));
    calls = []; out = []; err = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ ok: false, description: `Forbidden: ${String(input)}` }), { status: 403 });
    }) as typeof fetch;
    spies = [
      spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); }),
      spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.join(" ")); }),
    ];
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    for (const s of spies) s.mockRestore();
  });

  test("flags", () => {
    expect(parseArgs(["notify", "--date", "2026-11-22", "--dry-run"])).toMatchObject({ cmd: "notify", date: "2026-11-22", dryRun: true });
    expect(() => parseArgs(["notify", "--date", "2026-02-30"])).toThrow(UsageError);
    expect(() => parseArgs(["notify", "--date", "today"])).toThrow(UsageError);
  });

  test("nothing configured: exit 0 and no request", async () => {
    setup("");
    expect(await run("--date", "2026-11-22")).toBe(0);
    expect(calls).toEqual([]);
    expect(err.join("\n")).toContain("no channels configured");
  });

  test("dry run prints the message, with the Pages URL as the portal link, and sends nothing", async () => {
    setup("notify: { channels: [telegram, ntfy] }");
    expect(await run("--date", "2026-11-22", "--dry-run")).toBe(0);
    expect(calls).toEqual([]);
    const printed = out.join("\n");
    expect(printed).toContain(`<a href="https://github.com/a/b">a/b</a> (30): 1 of your topics`);
    expect(printed).toContain(`<a href="https://me.github.io/portal/">`);
    expect(printed).not.toContain(BOT);
    expect(err.join("\n")).toContain("notify: telegram: dry-run");
    expect(err.join("\n")).toContain("warning: notify: ntfy: skipped (GITFORAGE_NTFY_TOPIC is not set)");
  });

  test("no digest for the date: exit 0, nothing sent", async () => {
    setup("notify: { channels: [telegram] }", "2026-11-15");
    expect(await run("--date", "2026-11-22")).toBe(0);
    expect(calls).toEqual([]);
  });

  test("a failed send is reported, redacted, and exits 1", async () => {
    setup("notify: { channels: [telegram] }");
    expect(await run("--date", "2026-11-22", "--quiet")).toBe(1);
    expect(calls.length).toBe(1);
    const e = err.join("\n");
    expect(e).toContain("notify: telegram: failed (HTTP 403: Forbidden");
    expect(e).not.toContain(BOT);
  });
});
