// Build the whole portal: every page, the feed and the assets, as a map of
// relative path to content. `writeSite` writes it under an output directory.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { isSafeFullName, toRevivalItem, type CatalogState, type Config, type Digest, type RevivalItem } from "@gitforage/core";
import { catalogFile } from "./personalize.ts";
import { atomFeed } from "./feed.ts";
import { aboutPage, archivePage, digestPage, modePage, pagesUrl, revivalPage, topicPage, topicsIndexPage, type SiteContext } from "./render.ts";

const ASSETS = ["site.css", "site.js", "theme.js", "icon.svg", "paper.svg", "paper-night.svg"];
/** The heading font's license travels with it (SIL OFL 1.1), published at a lowercase path. */
const FONT_LICENSE: [string, string] = ["fonts/OFL.txt", "assets/fonts/ofl.txt"];
/** Binary assets, copied byte for byte: the self-hosted heading font (see assets/fonts/SOURCE.md). */
export const BINARY_ASSETS = ["fonts/fraunces-fieldguide.woff2"];
/** Shipped only when site.personalize is on. */
export const PERSONALIZE_ASSETS = ["personalize.js", "personalize-core.js", "strings.js", "rings.js", "fieldnote.js"];
const assetDir = join(import.meta.dir, "..", "assets");

export interface BuildOptions {
  /** owner/name of the portal repo; overrides site.repo. */
  repo?: string | null;
  /** Build time (ISO). Defaults to now. */
  now?: string;
  /** state/catalog.json, for site.personalize. Validated again here. */
  catalog?: CatalogState | null;
  /** The revival radar (state/revival.json items), for revival.html. Validated again here. */
  revival?: RevivalItem[] | null;
}

export function siteContext(cfg: Config, o: BuildOptions = {}): SiteContext {
  const portal = o.repo ?? cfg.site.repo;
  if (portal !== null && portal !== undefined && !isSafeFullName(portal)) throw new Error("the portal repo must look like owner/name");
  return {
    cfg,
    portal: portal ?? null,
    baseUrl: cfg.site.url ?? (portal ? pagesUrl(portal) : null),
    updated: o.now ?? new Date().toISOString(),
  };
}

export function renderSite(cfg: Config, digests: Digest[], o: BuildOptions = {}): Map<string, string> {
  const ctx = siteContext(cfg, o);
  const files = new Map<string, string>();
  const latest = (mode: Digest["mode"]) => digests.find((d) => d.mode === mode) ?? null;
  files.set("index.html", modePage(ctx, "discover", latest("discover")));
  files.set("involved.html", modePage(ctx, "contribute", latest("contribute")));
  if (cfg.revival.enabled) {
    const items = (o.revival ?? []).slice(0, 100).map(toRevivalItem).filter((x): x is RevivalItem => x !== null);
    files.set("revival.html", revivalPage(ctx, items));
  }
  files.set("about.html", aboutPage(ctx));
  files.set("archive/index.html", archivePage(ctx, digests));
  for (const d of digests) files.set(`archive/${d.date}-${d.mode}.html`, digestPage(ctx, d));
  files.set("topics/index.html", topicsIndexPage(ctx, digests));
  for (const t of cfg.topics) files.set(`topics/${t}.html`, topicPage(ctx, digests, t));
  files.set("feed.xml", atomFeed(digests, { title: cfg.site.title, baseUrl: ctx.baseUrl, updated: ctx.updated }));
  for (const a of ASSETS) files.set(`assets/${a}`, readFileSync(join(assetDir, a), "utf8"));
  files.set(FONT_LICENSE[1], readFileSync(join(assetDir, FONT_LICENSE[0]), "utf8"));
  if (cfg.site.personalize.enabled) {
    files.set("catalog.json", JSON.stringify(catalogFile(cfg, o.catalog ?? null, ctx.portal)));
    for (const a of PERSONALIZE_ASSETS) files.set(`assets/${a}`, readFileSync(join(assetDir, a), "utf8"));
  }
  return files;
}

/** The binary assets (the font), to write next to renderSite's text files. */
export function siteBinaries(): Map<string, Uint8Array> {
  return new Map(BINARY_ASSETS.map((a) => [`assets/${a}`, new Uint8Array(readFileSync(join(assetDir, a)))]));
}

/** Write the files under outDir. Paths come from renderSite only and must stay inside outDir. */
export function writeSite(outDir: string, files: Map<string, string | Uint8Array>): number {
  const root = resolve(outDir);
  for (const [rel, content] of files) {
    if (!/^[a-z0-9][a-z0-9._/-]*$/.test(rel) || rel.includes("..")) throw new Error(`bad output path ${rel}`);
    const p = resolve(root, rel);
    if (!p.startsWith(root + sep)) throw new Error(`bad output path ${rel}`);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return files.size;
}
