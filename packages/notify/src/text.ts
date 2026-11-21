// Making digest text safe for each channel. Repo text (release tags, licence names,
// matched keywords in reasons) is untrusted even after the digest loader has cleaned
// it: it must not turn into a link, a mention or markup in a chat app.

import { cleanText } from "@gitforage/core";

/**
 * Stop chat apps from turning untrusted text into links or mentions: "evil.com"
 * becomes "evil[.]com", "https://" becomes "https[:]//", "javascript:" becomes
 * "javascript[:]" and "@name" becomes "＠name" (a fullwidth at sign). Version numbers such as "v1.2.3" are left alone, since a
 * dot followed by a digit cannot start a top-level domain.
 */
export function defang(s: string): string {
  return s
    .replace(/:\/\//g, "[:]//")
    .replace(/\b(javascript|vbscript|data|file):/gi, "$1[:]")
    .replace(/([\p{L}\p{N}-])\.(?=\p{L})/gu, "$1[.]")
    .replace(/@/g, "＠");
}

/** Clean (control, bidi and zero-width characters out, length capped) and defang. */
export function safeText(s: unknown, max: number): string {
  return defang(cleanText(s, max));
}

/** Telegram parse_mode HTML: the three characters it requires escaped, plus quotes for attributes. */
export function telegramEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Slack mrkdwn: &, < and > are the control characters (links, mentions, <!channel>). */
export function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Discord markdown: backslash-escape markdown and mention syntax (<@id>, <#id>, <@&id>,
 * <t:...>), and put a zero-width space after every at sign so @everyone and @here stay
 * plain text. The payload also sets allowed_mentions to nothing, so this is belt and braces.
 */
export function discordEscape(s: string): string {
  return s.replace(/([\\`*_~|>#\[\]()<])/g, "\\$1").replace(/[@＠]/g, (m) => `${m}\u200b`);
}

export const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/**
 * Join a header, item blocks and a footer under a size limit. Items are added whole,
 * in order, while they fit; the rest are counted in a "...and N more" line. The footer
 * is dropped if even it does not fit, and as a last resort the header is cut (by whole
 * characters). Headers are a short title and a date, so that is not reached in practice.
 */
export function fitBlocks(
  head: string,
  blocks: string[],
  foot: string,
  limit: number,
  measure: (s: string) => number = (s) => s.length,
  more: (n: number) => string = (n) => `...and ${n} more`,
): string {
  const join = (parts: string[]) => parts.filter((p) => p !== "").join("\n");
  let kept = blocks.length;
  const build = (k: number, withFoot: boolean) => join([head, ...blocks.slice(0, k), k < blocks.length ? more(blocks.length - k) : "", withFoot ? foot : ""]);
  for (const withFoot of [true, false]) {
    for (kept = blocks.length; kept >= 0; kept--) {
      const t = build(kept, withFoot);
      if (measure(t) <= limit) return t;
    }
  }
  let t = build(0, false);
  const chars = Array.from(t);
  while (chars.length && measure(chars.join("")) > limit) chars.pop();
  return chars.join("");
}
