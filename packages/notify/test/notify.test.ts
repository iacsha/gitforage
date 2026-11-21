// Notifiers: hostile digest text stays inert per channel, messages fit each API's
// limit, secrets never reach an error message, missing env skips, and a dry run sends
// nothing. No network: every test injects a fake fetch.

import { describe, expect, test } from "bun:test";
import { DEFAULT_NOTIFY, parseConfig, parseDigest, type Digest, type NotifyConfig } from "@gitforage/core";
import {
  buildSummary, defang, discordEscape, LIMITS, notify, redact, renderDiscord, renderJson, renderPlain, renderSlack, renderTelegram,
  telegramEscape, utf8Length, type Summary,
} from "../src/index.ts";

const DATE = "2026-11-22";
const PORTAL = "https://me.github.io/portal/";
const BOT = "123456789:AAH-abcdefghijklmnopqrstuvwxyz_0123";
const CHAT = "-1001234567890";
const TOPIC = "my-secret-topic_42";
const HOOK = "https://discord.com/api/webhooks/111/SECRETpathTOKEN-xyz";

const HOSTILE = [
  `<script>alert(1)</script> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>`,
  `*bold* _it_ ~~s~~ \`code\` [click](https://evil.example/p) <https://evil.example|ok> &amp;`,
  `@everyone @here <@123456> <@&42> <#99> <!channel> <!here> <t:1:R>`,
  `\u202Egnp.exe\u202C bidi \u2066x\u2069 zero\u200Bwidth \u0007bell \u001b[31mred`,
  "released evil.example 1 day ago, see http://169.254.169.254/ and user@host.example",
];

/** A digest as it would be read back from disk: through the validated loader. */
function digest(mode: "discover" | "contribute", items: { name: string; score?: number; reasons?: { rule: string; points: number; text: string }[]; description?: string }[], date = DATE): Digest {
  const body = {
    version: 1,
    items: items.map((i) => ({ full_name: i.name, score: i.score ?? 10, stars: 5, description: i.description ?? "", reasons: i.reasons ?? [] })),
  };
  const r = parseDigest(JSON.stringify(body), `${date}-${mode}.json`);
  if (!r.digest) throw new Error(r.problems.join("; "));
  return r.digest;
}

const hostileDigest = () => digest("discover", HOSTILE.map((t, i) => ({
  name: i === 0 ? "evil/x.com" : `owner${i}/repo_${i}.js`,
  score: 40 - i,
  reasons: [{ rule: "release", points: 5, text: t }, { rule: "stars", points: 1, text: "5 stars" }],
  description: `<script>steal()</script> [x](javascript:alert(1)) @everyone ${"long ".repeat(200)}`,
})));

const hostileSummary = () => buildSummary([hostileDigest()], { date: DATE, top: 20, portal: PORTAL });

const ALLOWED_LINK = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$|^https:\/\/me\.github\.io\/portal\/$/;
const urlsIn = (s: string) => [...s.matchAll(/https?:\/\/[^\s<>|"\\]+/g)].map((m) => m[0]);

describe("hostile repo text", () => {
  test("defang: links and mentions in untrusted text are broken, version numbers are not", () => {
    expect(defang("see https://evil.example/x")).toBe("see https[:]//evil[.]example/x");
    expect(defang("released v1.2.3")).toBe("released v1.2.3");
    expect(defang("@everyone")).toBe("＠everyone");
  });

  test("no format carries a link other than repo links and the portal", () => {
    const s = hostileSummary();
    for (const text of [renderPlain(s), renderTelegram(s), renderSlack(s), renderDiscord(s), JSON.stringify(renderJson(s))]) {
      const urls = urlsIn(text);
      expect(urls.length).toBeGreaterThan(0);
      for (const u of urls) expect(u).toMatch(ALLOWED_LINK);
      expect(text).not.toContain("javascript:");
      expect(text).not.toContain("evil.example");
      expect(text).not.toContain("://169.254");
      // Descriptions are never part of a message.
      expect(text).not.toContain("steal()");
    }
  });

  test("control, bidi and zero-width characters are stripped (Discord adds only its own zero-width space after @)", () => {
    const s = hostileSummary();
    for (const text of [renderPlain(s), renderTelegram(s), renderSlack(s), renderDiscord(s).replace(/[@＠]\u200b/g, "@")]) {
      expect(text).not.toMatch(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/);
    }
  });

  test("Telegram HTML: only <b> and <a href> to allowed links; everything else is escaped", () => {
    const t = renderTelegram(hostileSummary());
    for (const [tag] of t.matchAll(/<[^>]*>/g)) {
      expect(tag).toMatch(/^<\/?b>$|^<\/a>$|^<a href="(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|https:\/\/me\.github\.io\/portal\/)">$/);
    }
    expect(t).toContain("&lt;script&gt;");
    expect(t).not.toContain("<script");
    expect(telegramEscape(`<a href="x">&`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;");
  });

  test("Slack: &, < and > escaped, so no <!channel>, <@user> or foreign <url|label>", () => {
    const t = renderSlack(hostileSummary());
    for (const [tag] of t.matchAll(/<[^>]*>/g)) expect(tag).toMatch(/^<https:\/\/(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|me\.github\.io\/portal\/)\|[^<>]+>$/);
    expect(t).not.toContain("<!");
    expect(t).not.toContain("<@");
    expect(t).toContain("&lt;!channel&gt;");
    expect(t).toContain("&amp;amp;");
  });

  test("Discord: no live @everyone, @here or <@id>/<#id>/<t:> syntax, and markdown is escaped", () => {
    const t = renderDiscord(hostileSummary());
    expect(t).not.toMatch(/@(everyone|here)/);
    expect(t).not.toMatch(/(?<!\\)<[@#!t]/);
    expect(t).not.toMatch(/(?<!\\)\[click\]/);
    for (const [tag] of t.matchAll(/(?<!\\)<[^>]*>/g)) expect(tag).toMatch(/^<https:\/\/(github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|me\.github\.io\/portal\/)>$/);
    expect(discordEscape("@everyone <@1> *x*")).toBe("@\u200beveryone \\<@\u200b1\\> \\*x\\*");
  });

  test("bad names never reach a message; links are rebuilt from the name, not read from the digest", () => {
    const d = digest("discover", [{ name: "a/b" }]);
    d.items.push({ ...d.items[0], full_name: "../etc", url: "https://evil.example/" });
    d.items[0] = { ...d.items[0], url: "https://evil.example/" };
    const s = buildSummary([d], { date: DATE, top: 5, portal: null });
    expect(s.total).toBe(1);
    expect(s.sections[0].items[0].url).toBe("https://github.com/a/b");
    expect(renderPlain(s)).not.toContain("evil");
  });

  test("an unvalidated portal URL is dropped", () => {
    expect(buildSummary([hostileDigest()], { date: DATE, top: 5, portal: "javascript:alert(1)" }).portal).toBeNull();
    expect(buildSummary([hostileDigest()], { date: DATE, top: 5, portal: "http://me.github.io/" }).portal).toBeNull();
  });

  test("overlong reasons are capped", () => {
    const d = digest("discover", [{ name: "a/b", reasons: [{ rule: "release", points: 3, text: "x".repeat(5000) }] }]);
    const s = buildSummary([d], { date: DATE, top: 5, portal: null });
    expect(s.sections[0].items[0].reason!.length).toBeLessThanOrEqual(120);
  });
});

describe("summary", () => {
  test("takes the top N of each digest of that date, with the highest-scoring reason", () => {
    const disc = digest("discover", Array.from({ length: 8 }, (_, i) => ({
      name: `o/d${i}`, score: 50 - i, reasons: [{ rule: "stars", points: 1, text: "5 stars" }, { rule: "topic_match", points: 9, text: "3 of your topics" }],
    })));
    const cont = digest("contribute", [{ name: "o/c0", score: 12.6 }]);
    const old = digest("discover", [{ name: "o/old" }], "2026-11-15");
    const s = buildSummary([disc, cont, old], { date: DATE, top: 3, portal: PORTAL, title: "My forage" });
    expect(s.total).toBe(9);
    expect(s.sections.map((x) => [x.label, x.items.length, x.total])).toEqual([["Discover", 3, 8], ["Get involved", 1, 1]]);
    expect(s.sections[0].items[0]).toEqual({ mode: "discover", full_name: "o/d0", url: "https://github.com/o/d0", score: 50, reason: "3 of your topics" });
    expect(s.sections[1].items[0]).toMatchObject({ score: 13, reason: null });
    const plain = renderPlain(s);
    expect(plain).toStartWith("My forage, 2026-11-22: 9 new finds");
    expect(plain).toContain("1. o/d0 (50): 3 of your topics\nhttps://github.com/o/d0");
    expect(plain).toContain("Get involved");
    expect(plain).toContain(`All of them: ${PORTAL}`);
    expect(plain).not.toContain("o/old");
  });
});

describe("message caps", () => {
  const big = (): Summary => {
    const reasons = [{ rule: "release", points: 3, text: `${"日本語テキスト🦊".repeat(30)}` }];
    const many = (mode: "discover" | "contribute") => digest(mode, Array.from({ length: 20 }, (_, i) => ({ name: `owner-${mode}-${i}/a-rather-long-repository-name-${i}`, reasons })));
    return buildSummary([many("discover"), many("contribute")], { date: DATE, top: 20, portal: PORTAL });
  };

  test("every format stays within its API's limit, dropping whole items into an '...and N more' line", () => {
    const s = big();
    const cases: [string, string, number, (t: string) => number][] = [
      ["ntfy", renderPlain(s), LIMITS.ntfy, utf8Length],
      ["telegram", renderTelegram(s), LIMITS.telegram, (t) => t.length],
      ["slack", renderSlack(s), LIMITS.slack, (t) => t.length],
      ["discord", renderDiscord(s), LIMITS.discord, (t) => t.length],
      ["json", renderJson(s).text as string, LIMITS.json, (t) => t.length],
    ];
    for (const [name, text, limit, measure] of cases) {
      expect({ name, ok: measure(text) <= limit }).toEqual({ name, ok: true });
      expect(text).toMatch(/\.\.\.and \d+ more/);
    }
    // Telegram keeps its markup balanced: items are never cut in half.
    const t = renderTelegram(s);
    expect((t.match(/<a /g) ?? []).length).toBe((t.match(/<\/a>/g) ?? []).length);
    expect((t.match(/<b>/g) ?? []).length).toBe((t.match(/<\/b>/g) ?? []).length);
  });
});

describe("config", () => {
  const cfg = (notify: string) => parseConfig(`topics: [hl7]\n${notify}`);

  test("defaults: nothing enabled", () => {
    expect(cfg("").notify).toEqual(DEFAULT_NOTIFY);
    expect(DEFAULT_NOTIFY).toEqual({ top: 5, channels: [], webhook_format: "json", ntfy_server: "https://ntfy.sh/" });
  });

  test("a full block", () => {
    expect(cfg("notify: { top: 7, channels: [ntfy, telegram, webhook, ntfy], webhook_format: slack, ntfy_server: 'https://ntfy.example.org:8443/push' }").notify)
      .toEqual({ top: 7, channels: ["ntfy", "telegram", "webhook"], webhook_format: "slack", ntfy_server: "https://ntfy.example.org:8443/push/" });
  });

  test("strict: unknown keys, ranges, channels, formats and an https server", () => {
    const bad: [string, RegExp][] = [
      ["notify: { topic: abc }", /notify\.topic: unknown key/],
      ["notify: { token: abc }", /notify\.token: unknown key/],
      ["notify: { top: 0 }", /notify\.top: must be between 1 and 20/],
      ["notify: { top: 21 }", /notify\.top: must be between 1 and 20/],
      ["notify: { top: 2.5 }", /notify\.top: must be a whole number/],
      ["notify: { channels: [email] }", /notify\.channels: must be some of ntfy, telegram, webhook/],
      ["notify: { channels: ntfy }", /notify\.channels: must be a list/],
      ["notify: { webhook_format: teams }", /notify\.webhook_format: must be one of json, slack, discord/],
      ["notify: { ntfy_server: 'http://ntfy.sh' }", /notify\.ntfy_server: must be a plain https/],
      ["notify: { ntfy_server: 'https://user:pw@ntfy.sh' }", /notify\.ntfy_server/],
      ["notify: { ntfy_server: 'https://ntfy.sh/?x=1' }", /notify\.ntfy_server/],
      ["notify: yes", /notify: must be a mapping/],
    ];
    for (const [y, re] of bad) expect(() => cfg(y)).toThrow(re);
  });
});

// --- senders ---

interface Call { url: string; init: RequestInit }
function fakeFetch(calls: Call[], respond: (url: string) => Response | Promise<Response> = () => new Response("{}", { status: 200 })) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond(String(input));
  }) as typeof fetch;
}

const ALL: NotifyConfig = { ...DEFAULT_NOTIFY, channels: ["ntfy", "telegram", "webhook"] };
const FULL_ENV = {
  GITFORAGE_NTFY_TOPIC: TOPIC, GITFORAGE_NTFY_TOKEN: "tk_ntfysecret123",
  GITFORAGE_TELEGRAM_BOT_TOKEN: BOT, GITFORAGE_TELEGRAM_CHAT_ID: CHAT, GITFORAGE_WEBHOOK_URL: HOOK,
};
const summary = () => buildSummary([digest("discover", [{ name: "a/b", reasons: [{ rule: "stars", points: 1, text: "5 stars" }] }])], { date: DATE, top: 5, portal: PORTAL });

describe("senders", () => {
  test("requests: fixed Telegram host, no redirects, a timeout, and each channel's safe options", async () => {
    const calls: Call[] = [];
    const out = await notify({ config: { ...ALL, webhook_format: "discord" }, summary: summary(), env: FULL_ENV, fetch: fakeFetch(calls) });
    expect(out.map((o) => o.status)).toEqual(["sent", "sent", "sent"]);
    expect(calls.length).toBe(3);
    for (const c of calls) {
      expect(c.init.redirect).toBe("error");
      expect(c.init.signal).toBeInstanceOf(AbortSignal);
      expect(c.init.method).toBe("POST");
    }
    const [ntfy, tg, hook] = calls;
    expect(ntfy.url).toBe(`https://ntfy.sh/${TOPIC}`);
    const nh = ntfy.init.headers as Record<string, string>;
    expect(nh.Markdown).toBe("no");
    expect(nh["Content-Type"]).toStartWith("text/plain");
    expect(nh.Authorization).toBe("Bearer tk_ntfysecret123");
    expect(nh.Click).toBe(PORTAL);
    expect(new URL(tg.url).host).toBe("api.telegram.org");
    expect(new URL(tg.url).pathname).toBe(`/bot${BOT}/sendMessage`);
    const tb = JSON.parse(String(tg.init.body));
    expect(tb).toMatchObject({ chat_id: CHAT, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    expect(hook.url).toBe(HOOK);
    const hb = JSON.parse(String(hook.init.body));
    expect(hb.allowed_mentions).toEqual({ parse: [] });
    expect(hb.flags).toBe(4);
    expect(hb.content.length).toBeLessThanOrEqual(LIMITS.discord);
  });

  test("webhook payloads: json and slack", async () => {
    for (const format of ["json", "slack"] as const) {
      const calls: Call[] = [];
      await notify({ config: { ...DEFAULT_NOTIFY, channels: ["webhook"], webhook_format: format }, summary: summary(), env: FULL_ENV, fetch: fakeFetch(calls) });
      const body = JSON.parse(String(calls[0].init.body));
      if (format === "json") expect(body).toMatchObject({ version: 1, source: "gitforage", date: DATE, portal: PORTAL, items: [{ full_name: "a/b", url: "https://github.com/a/b" }] });
      else expect(body).toMatchObject({ unfurl_links: false, unfurl_media: false, text: expect.stringContaining("<https://github.com/a/b|a/b>") });
    }
  });

  test("dry run sends nothing and shows every channel's message", async () => {
    const calls: Call[] = [];
    const out = await notify({ config: ALL, summary: summary(), env: FULL_ENV, dryRun: true, fetch: fakeFetch(calls) });
    expect(calls.length).toBe(0);
    expect(out.map((o) => o.status)).toEqual(["dry-run", "dry-run", "dry-run"]);
    for (const o of out) {
      expect(o.preview).toContain("a/b");
      for (const secret of [BOT, TOPIC, HOOK, CHAT, "tk_ntfysecret123"]) expect(`${o.preview} ${o.detail}`).not.toContain(secret);
    }
    // Missing env still previews the message, and is still skipped.
    const bare = await notify({ config: ALL, summary: summary(), env: {}, dryRun: true, fetch: fakeFetch(calls) });
    expect(calls.length).toBe(0);
    expect(bare.map((o) => [o.status, !!o.preview])).toEqual([["skipped", true], ["skipped", true], ["skipped", true]]);
  });

  test("missing env: the channel is skipped with the variable named, and nothing is fetched", async () => {
    const calls: Call[] = [];
    const out = await notify({ config: ALL, summary: summary(), env: { GITFORAGE_TELEGRAM_BOT_TOKEN: BOT, GITFORAGE_WEBHOOK_URL: "  " }, fetch: fakeFetch(calls) });
    expect(calls.length).toBe(0);
    expect(out).toEqual([
      { channel: "ntfy", status: "skipped", detail: "GITFORAGE_NTFY_TOPIC is not set" },
      { channel: "telegram", status: "skipped", detail: "GITFORAGE_TELEGRAM_CHAT_ID not set" },
      { channel: "webhook", status: "skipped", detail: "GITFORAGE_WEBHOOK_URL is not set" },
    ]);
  });

  test("malformed env fails without fetching and without echoing the value", async () => {
    const env = {
      GITFORAGE_NTFY_TOPIC: "../../admin?x=1", GITFORAGE_TELEGRAM_BOT_TOKEN: "123:abc/../../evil", GITFORAGE_TELEGRAM_CHAT_ID: CHAT,
      GITFORAGE_WEBHOOK_URL: "http://hooks.example/secret-http-path",
    };
    const calls: Call[] = [];
    const out = await notify({ config: ALL, summary: summary(), env, fetch: fakeFetch(calls) });
    expect(calls.length).toBe(0);
    expect(out.map((o) => o.status)).toEqual(["failed", "failed", "failed"]);
    for (const o of out) for (const v of Object.values(env)) expect(o.detail).not.toContain(v);
    const creds = await notify({ config: { ...ALL, channels: ["webhook"] }, summary: summary(), env: { GITFORAGE_WEBHOOK_URL: "https://u:p@hooks.example/x" }, fetch: fakeFetch(calls) });
    expect(creds[0].status).toBe("failed");
  });

  test("tokens are redacted from thrown errors and from response bodies", async () => {
    const throwing = (async (input: string | URL | Request) => {
      throw new TypeError(`fetch failed: redirect blocked for ${String(input)} (also ${encodeURIComponent(String(input))})`);
    }) as unknown as typeof fetch;
    const out = await notify({ config: ALL, summary: summary(), env: FULL_ENV, fetch: throwing });
    expect(out.map((o) => o.status)).toEqual(["failed", "failed", "failed"]);
    for (const o of out) {
      for (const secret of [BOT, TOPIC, HOOK, "SECRETpathTOKEN-xyz", "/api/webhooks/111/SECRETpathTOKEN-xyz"]) expect(o.detail).not.toContain(secret);
      expect(o.detail).toContain("[REDACTED]");
    }
    // Telegram echoes the request in an error description.
    const echo = fakeFetch([], (url) => new Response(JSON.stringify({ ok: false, description: `Unauthorized: ${url} token ${BOT}` }), { status: 401 }));
    const tg = await notify({ config: { ...ALL, channels: ["telegram"] }, summary: summary(), env: FULL_ENV, fetch: echo });
    expect(tg[0].status).toBe("failed");
    expect(tg[0].detail).toStartWith("HTTP 401: Unauthorized");
    expect(tg[0].detail).not.toContain(BOT);
    expect(tg[0].detail).not.toContain(BOT.split(":")[1]);
  });

  test("redact replaces plain and URL-encoded secrets, longest first", () => {
    expect(redact(`a ${BOT} b ${encodeURIComponent(BOT)}`, [BOT, null, ""])).toBe("a [REDACTED] b [REDACTED]");
  });

  test("timeouts and HTTP errors are failures with a short, clean detail", async () => {
    const timeout = (async () => { throw new DOMException("The operation timed out.", "TimeoutError"); }) as unknown as typeof fetch;
    const t = await notify({ config: { ...ALL, channels: ["ntfy"] }, summary: summary(), env: FULL_ENV, fetch: timeout });
    expect(t[0]).toEqual({ channel: "ntfy", status: "failed", detail: "timed out after 15s" });
    const huge = fakeFetch([], () => new Response(`\u202E${"x".repeat(100_000)}`, { status: 500 }));
    const h = await notify({ config: { ...ALL, channels: ["ntfy"] }, summary: summary(), env: FULL_ENV, fetch: huge });
    expect(h[0].status).toBe("failed");
    expect(h[0].detail.length).toBeLessThanOrEqual(220);
    expect(h[0].detail).not.toContain("\u202E");
  });

  test("a custom ntfy server is used as the base", async () => {
    const calls: Call[] = [];
    await notify({ config: { ...DEFAULT_NOTIFY, channels: ["ntfy"], ntfy_server: "https://push.example.org:8443/n/" }, summary: summary(), env: FULL_ENV, fetch: fakeFetch(calls) });
    expect(calls[0].url).toBe(`https://push.example.org:8443/n/${TOPIC}`);
  });
});

test("defang: non-ASCII domain labels are broken too", () => {
  expect(defang("win at бонус.com or 例え.jp")).toBe("win at бонус[.]com or 例え[.]jp");
  expect(defang("v1.2.3")).toBe("v1.2.3");
});
