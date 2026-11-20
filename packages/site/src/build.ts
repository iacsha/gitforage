// Build the whole portal: every page, the feed and the assets, as a map of
// relative path to content. `writeSite` writes it under an output directory.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { isSafeFullName, type Config, type Digest } from "@gitforage/core";
import { atomFeed } from "./feed.ts";
import { aboutPage, archivePage, digestPage, modePage, pagesUrl, topicPage, topicsIndexPage, type SiteContext } from "./render.ts";

const ASSETS = ["site.css", "site.js", "theme.js", "icon.svg"];
const assetDir = join(import.meta.dir, "..", "assets");

export interface BuildOptions {
  /** owner/name of the portal repo; overrides site.repo. */
  repo?: string | null;
  /** Build time (ISO). Defaults to now. */
  now?: string;
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
  files.set("about.html", aboutPage(ctx));
  files.set("archive/index.html", archivePage(ctx, digests));
  for (const d of digests) files.set(`archive/${d.date}-${d.mode}.html`, digestPage(ctx, d));
  files.set("topics/index.html", topicsIndexPage(ctx, digests));
  for (const t of cfg.topics) files.set(`topics/${t}.html`, topicPage(ctx, digests, t));
  files.set("feed.xml", atomFeed(digests, { title: cfg.site.title, baseUrl: ctx.baseUrl, updated: ctx.updated }));
  for (const a of ASSETS) files.set(`assets/${a}`, readFileSync(join(assetDir, a), "utf8"));
  return files;
}

/** Write the files under outDir. Paths come from renderSite only and must stay inside outDir. */
export function writeSite(outDir: string, files: Map<string, string>): number {
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
