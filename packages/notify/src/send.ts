// Senders: ntfy, Telegram and a generic webhook (json, slack or discord payloads).
//
// Secrets come only from the environment and are never logged: every error text that
// could carry one (the Telegram bot token is part of the request path) is redacted.
// Requests time out after 15 s and never follow redirects, so a server cannot bounce
// a payload, or a token in a path, somewhere else.

import { cleanText, type NotifyChannel, type NotifyConfig } from "@gitforage/core";
import { renderDiscord, renderJson, renderPlain, renderSlack, renderTelegram, type Summary } from "./message.ts";

export const TIMEOUT_MS = 15_000;
/** Most response bytes read back (for an error description). */
const MAX_RESPONSE_BYTES = 16 * 1024;
export const TELEGRAM_API = "https://api.telegram.org";

export const ENV = {
  ntfyTopic: "GITFORAGE_NTFY_TOPIC",
  ntfyToken: "GITFORAGE_NTFY_TOKEN",
  telegramToken: "GITFORAGE_TELEGRAM_BOT_TOKEN",
  telegramChat: "GITFORAGE_TELEGRAM_CHAT_ID",
  webhookUrl: "GITFORAGE_WEBHOOK_URL",
} as const;

const NTFY_TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_TOKEN_RE = /^\d{1,20}:[A-Za-z0-9_-]{20,200}$/;
const CHAT_ID_RE = /^(?:-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;
/** ntfy access tokens and passwords: printable ASCII only (it goes in a header). */
const HEADER_SAFE_RE = /^[\x21-\x7E]{1,512}$/;

export type Status = "sent" | "skipped" | "failed" | "dry-run";

export interface Outcome {
  channel: NotifyChannel;
  status: Status;
  /** Safe to print: no secrets, redacted. */
  detail: string;
  /** dry-run only: the message that would be sent. */
  preview?: string;
}

/** A ready request. The URL may hold a secret, so it is never printed. */
interface Prepared { url: string; init: RequestInit; preview: string; secrets: string[] }

type Env = Record<string, string | undefined>;
const val = (env: Env, k: string) => {
  const v = env[k]?.trim();
  return v ? v : null;
};

/** Replace every secret (and its URL-encoded form) in text with [REDACTED]. */
export function redact(text: string, secrets: (string | null | undefined)[]): string {
  let out = text;
  const list = secrets.filter((s): s is string => !!s && s.length >= 4);
  for (const s of list.flatMap((s) => [s, encodeURIComponent(s)]).sort((a, b) => b.length - a.length)) out = out.split(s).join("[REDACTED]");
  return out;
}

/** An https webhook URL with no credentials in it; anything else is refused. */
export function checkWebhookUrl(v: string): URL | null {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
  return u;
}

/** Missing env: a reason to skip. Bad env: a reason to fail. */
type Prep = { ok: Prepared } | { skip: string } | { fail: string };

function prepNtfy(cfg: NotifyConfig, s: Summary, env: Env): Prep {
  const topic = val(env, ENV.ntfyTopic);
  if (!topic) return { skip: `${ENV.ntfyTopic} is not set` };
  if (!NTFY_TOPIC_RE.test(topic)) return { fail: `${ENV.ntfyTopic} must be 1 to 64 letters, digits, - or _` };
  const token = val(env, ENV.ntfyToken);
  if (token && !HEADER_SAFE_RE.test(token)) return { fail: `${ENV.ntfyToken} must be printable ASCII without spaces` };
  const body = renderPlain(s);
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    Title: `${s.title.replace(/[^\x20-\x7E]/g, "").trim() || "gitforage"} ${s.date}`,
    Markdown: "no",
  };
  if (s.portal) headers.Click = s.portal;
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ok: { url: `${cfg.ntfy_server}${topic}`, init: { method: "POST", headers, body }, preview: body, secrets: [topic, token ?? ""] } };
}

function prepTelegram(s: Summary, env: Env): Prep {
  const token = val(env, ENV.telegramToken), chat = val(env, ENV.telegramChat);
  if (!token || !chat) return { skip: `${[!token && ENV.telegramToken, !chat && ENV.telegramChat].filter(Boolean).join(" and ")} not set` };
  if (!BOT_TOKEN_RE.test(token)) return { fail: `${ENV.telegramToken} does not look like a bot token (digits:letters)` };
  if (!CHAT_ID_RE.test(chat)) return { fail: `${ENV.telegramChat} must be a numeric chat id or @channelname` };
  const text = renderTelegram(s);
  const body = JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  // The host is fixed; only the validated token goes into the path.
  return {
    ok: { url: `${TELEGRAM_API}/bot${token}/sendMessage`, init: { method: "POST", headers: { "Content-Type": "application/json" }, body }, preview: text, secrets: [token, chat] },
  };
}

function prepWebhook(cfg: NotifyConfig, s: Summary, env: Env): Prep {
  const raw = val(env, ENV.webhookUrl);
  if (!raw) return { skip: `${ENV.webhookUrl} is not set` };
  const u = checkWebhookUrl(raw);
  if (!u) return { fail: `${ENV.webhookUrl} must be an https:// URL without credentials` };
  let payload: Record<string, unknown>;
  let preview: string;
  if (cfg.webhook_format === "slack") {
    preview = renderSlack(s);
    payload = { text: preview, unfurl_links: false, unfurl_media: false };
  } else if (cfg.webhook_format === "discord") {
    preview = renderDiscord(s);
    // No mentions of anyone, whatever the text says; flags 4 = SUPPRESS_EMBEDS.
    payload = { content: preview, allowed_mentions: { parse: [] }, flags: 4 };
  } else {
    payload = renderJson(s);
    preview = JSON.stringify(payload, null, 2);
  }
  // The whole URL is a secret for Slack and Discord (their tokens are in the path).
  const secrets = [raw, u.href, u.pathname.length > 1 ? u.pathname : "", u.search];
  return { ok: { url: u.href, init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, preview, secrets } };
}

/** Read at most MAX_RESPONSE_BYTES of a response body as text. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (n < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      n += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(Math.min(n, MAX_RESPONSE_BYTES));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, all.length - off);
    all.set(part, off);
    off += part.length;
    if (off >= all.length) break;
  }
  return new TextDecoder().decode(all);
}

/** A short, safe description of a failed response: Telegram's and ntfy's JSON errors carry one. */
function describe(body: string): string {
  try {
    const j = JSON.parse(body);
    const d = j?.description ?? j?.error ?? j?.message;
    if (typeof d === "string") return d;
  } catch {}
  return body;
}

async function send(p: Prepared, fetchFn: typeof fetch): Promise<{ ok: boolean; detail: string }> {
  const clean = (t: string) => cleanText(redact(t, p.secrets), 200);
  try {
    const res = await fetchFn(p.url, { ...p.init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await readCapped(res).catch(() => "");
    if (res.ok) return { ok: true, detail: `HTTP ${res.status}` };
    const why = clean(describe(text));
    return { ok: false, detail: `HTTP ${res.status}${why ? `: ${why}` : ""}` };
  } catch (e) {
    const err = e as Error;
    const what = err?.name === "TimeoutError" ? `timed out after ${TIMEOUT_MS / 1000}s` : clean(String(err?.message ?? err));
    return { ok: false, detail: what || "request failed" };
  }
}

export interface NotifyOptions {
  config: NotifyConfig;
  summary: Summary;
  env: Env;
  dryRun?: boolean;
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Send the summary to every configured channel, one after another. A channel whose
 * environment is missing is skipped; one whose environment is malformed, or whose
 * request fails, is reported as failed. With dryRun nothing is sent.
 */
export async function notify(o: NotifyOptions): Promise<Outcome[]> {
  const fetchFn = o.fetch ?? globalThis.fetch;
  const out: Outcome[] = [];
  for (const channel of o.config.channels) {
    const prep = channel === "ntfy" ? prepNtfy(o.config, o.summary, o.env)
      : channel === "telegram" ? prepTelegram(o.summary, o.env)
      : prepWebhook(o.config, o.summary, o.env);
    // A dry run shows the message even when the channel would be skipped or fail.
    const preview = o.dryRun ? ("ok" in prep ? prep.ok.preview : previewFor(channel, o.config, o.summary)) : undefined;
    if ("skip" in prep) { out.push({ channel, status: "skipped", detail: prep.skip, preview }); continue; }
    if ("fail" in prep) { out.push({ channel, status: "failed", detail: prep.fail, preview }); continue; }
    if (o.dryRun) { out.push({ channel, status: "dry-run", detail: "not sent (--dry-run)", preview }); continue; }
    const r = await send(prep.ok, fetchFn);
    out.push({ channel, status: r.ok ? "sent" : "failed", detail: r.detail });
  }
  return out;
}

/** The message a channel would carry, without any secret: for dry runs of channels that cannot be prepared. */
export function previewFor(channel: NotifyChannel, cfg: NotifyConfig, s: Summary): string {
  if (channel === "ntfy") return renderPlain(s);
  if (channel === "telegram") return renderTelegram(s);
  if (cfg.webhook_format === "slack") return renderSlack(s);
  if (cfg.webhook_format === "discord") return renderDiscord(s);
  return JSON.stringify(renderJson(s), null, 2);
}
