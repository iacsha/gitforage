// Every string from the GitHub API is untrusted: repo names, descriptions, topics,
// release tags, logins. This module is the one place that makes them safe to print,
// to put in markdown, or to build URLs and API paths from.

/** GitHub owner and repo name characters. Also rejects "." and ".." (path tricks). */
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export function isSafeName(s: string): boolean {
  return s.length > 0 && s.length <= 100 && NAME_RE.test(s) && s !== "." && s !== "..";
}

/** "owner/repo" with both halves passing isSafeName. */
export function isSafeFullName(full: string): boolean {
  const parts = full.split("/");
  return parts.length === 2 && isSafeName(parts[0]) && isSafeName(parts[1]);
}

export function isSafeLogin(s: string): boolean {
  return LOGIN_RE.test(s);
}

/** The only link gitforage emits for a repo. Never a URL taken from an API body. */
export function repoUrl(full: string): string | null {
  return isSafeFullName(full) ? `https://github.com/${full}` : null;
}

// C0 and C1 controls, bidi embeddings, overrides and isolates, zero-width characters
// and the BOM. These can spoof text direction, hide content or drive a terminal.
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁩﻿]/g;

/** Strip control and bidi characters, collapse whitespace, cap the length. */
export function cleanText(s: unknown, max = 300): string {
  const t = String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(CONTROL_RE, "").replace(/\s{2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * Make text inert in markdown (and in the HTML that markdown renders to): HTML-escape
 * & < > and backslash-escape every character that starts markdown syntax, including
 * the table pipe, link brackets and parentheses.
 */
export function mdEscape(s: unknown, max = 300): string {
  return cleanText(s, max)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_{}\[\]()#+!|~])/g, "\\$1");
}
