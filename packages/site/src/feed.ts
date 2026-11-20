// Atom 1.0 feed: one entry per digest item, newest digests first.
//
// Repo text is untrusted here too. `xmlEscape` strips characters that are not allowed
// in XML 1.0 (or that spoof text direction) and escapes the five XML specials, and
// every value goes through it. Entry links are rebuilt from validated names.

import { repoUrl, type Digest } from "@gitforage/core";
import { stripUnsafe } from "./html.ts";

const XML_ENTITY: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Escape text for an XML text node or a double-quoted attribute value. */
export function xmlEscape(v: unknown): string {
  return stripUnsafe(v).replace(/[&<>"']/g, (c) => XML_ENTITY[c]);
}

/** Most entries in the feed. */
export const MAX_FEED_ENTRIES = 100;

const MODE_TITLE = { discover: "Discover", contribute: "Get involved" } as const;

export interface FeedOptions {
  title: string;
  /** Public base URL ending in /, or null when unknown. */
  baseUrl: string | null;
  updated: string;
}

export function atomFeed(digests: Digest[], o: FeedOptions): string {
  const base = o.baseUrl;
  const feedId = base ? `${base}feed.xml` : "urn:gitforage:feed";
  const entries: string[] = [];
  for (const d of digests) {
    for (const it of d.items) {
      if (entries.length >= MAX_FEED_ENTRIES) break;
      const url = repoUrl(it.full_name);
      if (!url) continue;
      const id = base
        ? `${base}archive/${d.date}-${d.mode}.html#r-${it.full_name.replace("/", "-")}`
        : `urn:gitforage:${d.date}:${d.mode}:${it.full_name}`;
      const why = it.reasons.filter((r) => r.points > 0).slice(0, 4).map((r) => r.text).join("; ");
      const summary = [it.description, why && `Why: ${why}.`, `${it.stars} stars${it.language ? `, ${it.language}` : ""}.`].filter(Boolean).join(" ");
      entries.push([
        "  <entry>",
        `    <title>${xmlEscape(it.full_name)}</title>`,
        `    <id>${xmlEscape(id)}</id>`,
        `    <link rel="alternate" type="text/html" href="${xmlEscape(url)}"/>`,
        `    <updated>${xmlEscape(d.generated_at)}</updated>`,
        `    <category term="${d.mode}" label="${MODE_TITLE[d.mode]}"/>`,
        `    <summary type="text">${xmlEscape(summary)}</summary>`,
        "  </entry>",
      ].join("\n"));
    }
  }
  const head = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xmlEscape(o.title)}</title>`,
    "  <subtitle>GitHub projects that fit this portal's interests, from gitforage</subtitle>",
    `  <id>${xmlEscape(feedId)}</id>`,
    ...(base ? [`  <link rel="self" type="application/atom+xml" href="${xmlEscape(`${base}feed.xml`)}"/>`, `  <link rel="alternate" type="text/html" href="${xmlEscape(base)}"/>`] : []),
    `  <updated>${xmlEscape(digests[0]?.generated_at ?? o.updated)}</updated>`,
    "  <author><name>gitforage</name></author>",
    '  <generator uri="https://github.com/iacsha/gitforage">gitforage</generator>',
  ];
  return [...head, ...entries, "</feed>", ""].join("\n");
}
