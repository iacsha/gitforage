// The one HTML escaper, and a tagged template that applies it to every value.
//
// Everything the portal shows from a repo (name, description, topics, reasons) came
// from a stranger. `html` escapes each interpolated value unless it is already an
// `Html` value built by this module, so forgetting to escape is not possible by
// accident. Attribute values are always double-quoted, and `esc` escapes both quote
// characters, so a value cannot break out of an attribute either.

/**
 * C0 and C1 controls (except tab and newline, which become spaces), bidi embeddings,
 * overrides and isolates, zero-width characters, the BOM, and the two XML/HTML
 * noncharacters. These can reorder or hide text.
 */
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F؜​-‏‪-‮⁠-⁩﻿￾￿]/g;
const ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" };

/** Remove characters that can spoof or hide text; lone surrogates become U+FFFD. */
export function stripUnsafe(v: unknown): string {
  return String(v ?? "").toWellFormed().replace(/[\t\r\n]+/g, " ").replace(STRIP_RE, "");
}

/** Escape text for an HTML text node or a double-quoted attribute value. */
export function esc(v: unknown): string {
  return stripUnsafe(v).replace(/[&<>"'`]/g, (c) => ENTITY[c]);
}

/** Markup that is already safe. Only this module and the renderers create it. */
export class Html {
  constructor(readonly value: string) {}
  toString() { return this.value; }
}

/** Trusted, fixed markup written in this codebase. Never pass repo or visitor text. */
export const trusted = (s: string) => new Html(s);

function render(v: unknown): string {
  if (v instanceof Html) return v.value;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === null || v === undefined || v === false) return "";
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Html(out);
}

/** Relative links the site builds itself: lowercase paths, optional #fragment. */
const LOCAL_HREF_RE = /^(?:\.\.\/)*(?:[a-z0-9][a-z0-9._-]*\/)*(?:[a-z0-9][a-z0-9._-]*)?(?:#[A-Za-z0-9_.-]+)?$/;

/**
 * Guard for every href: a GitHub URL rebuilt from validated names, the project link,
 * or a relative link inside the site. Anything else (javascript:, data:, other hosts)
 * throws, so a bug cannot quietly emit a dangerous link.
 */
export function href(url: string): string {
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?(?:\/issues\/new\?[A-Za-z0-9%_.=&-]+)?(?:#[a-z0-9-]+)?$/.test(url)) return url;
  if (LOCAL_HREF_RE.test(url) && url !== "") return url;
  throw new Error(`refusing to emit link ${JSON.stringify(url.slice(0, 80))}`);
}
