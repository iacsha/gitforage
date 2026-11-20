#!/usr/bin/env bun
// Maintainer step: draw the social card (packages/site/assets/og-card.png, 1200x630).
//
//   CHROME=/path/to/chrome-headless-shell bun scripts/og-card.ts
//
// The card is committed, so building a portal never needs this script or a browser.
// It is drawn from fixed markup here: the sprig emblem (packages/site/design/logos/
// c-sprig.svg), the self-hosted Fraunces cut and the site's paper palette. A headless
// Chrome (any recent build, for example the chrome-headless-shell that puppeteer
// downloads) takes the screenshot. Rerun it after changing the emblem, the palette or
// the words below, and commit the PNG. On a machine without Chrome's shared libraries
// (libnss3 and friends), unpack them from the distro packages into a folder and point
// LD_LIBRARY_PATH at it; no root is needed.

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const site = join(root, "packages", "site");
const out = join(site, "assets", "og-card.png");
const chrome = process.env.CHROME;
if (!chrome) {
  console.error("set CHROME to a headless Chrome binary (chrome or chrome-headless-shell)");
  process.exit(2);
}

// The emblem without its <title> and dark-mode style: the card is always the day palette.
const sprig = readFileSync(join(site, "design", "logos", "c-sprig.svg"), "utf8")
  .replace(/<title>[\s\S]*?<\/title>/, "")
  .replace(/<style>[\s\S]*?<\/style>/, "")
  .replace("<svg ", '<svg width="330" height="330" ');

const page = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: "Fraunces"; src: url("fraunces.woff2") format("woff2"); font-weight: 400 700; }
html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
body { background: #f3ecdc url("paper.svg"); color: #241f17; font-family: "Fraunces", serif; }
.frame { position: absolute; inset: 28px; border: 6px double #d6c9ab; border-radius: 10px; background: rgba(251, 247, 236, 0.55); }
.row { position: absolute; inset: 0; display: flex; align-items: center; gap: 56px; padding: 0 96px; }
h1 { font-size: 148px; font-weight: 650; letter-spacing: -2px; margin: 0; line-height: 1; }
p { font-size: 50px; margin: 22px 0 0; color: #5d5444; font-weight: 420; }
.rule { height: 4px; width: 132px; background: #3d6a26; margin-top: 30px; border-radius: 2px; }
.stamp { position: absolute; right: 70px; bottom: 58px; font: 600 22px ui-monospace, "DejaVu Sans Mono", monospace; color: #8a4410; letter-spacing: 3px; text-transform: uppercase; }
</style></head><body>
<div class="frame"></div>
<div class="row">${sprig}<div><h1>gitforage</h1><p>A field guide to GitHub</p><div class="rule"></div></div></div>
<div class="stamp">Plate no. 001</div>
</body></html>`;

const dir = mkdtempSync(join(tmpdir(), "gitforage-og-"));
try {
  copyFileSync(join(site, "assets", "fonts", "fraunces-fieldguide.woff2"), join(dir, "fraunces.woff2"));
  copyFileSync(join(site, "assets", "paper.svg"), join(dir, "paper.svg"));
  writeFileSync(join(dir, "card.html"), page);
  const shot = join(dir, "card.png");
  const p = Bun.spawnSync([chrome, "--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=1200,630", "--virtual-time-budget=2000", `--screenshot=${shot}`, `file://${join(dir, "card.html")}`], { stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) throw new Error(`chrome exited ${p.exitCode}`);
  const png = readFileSync(shot);
  // PNG signature, then IHDR width and height as big-endian 32-bit numbers.
  if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) throw new Error("the screenshot is not 1200x630");
  writeFileSync(out, png);
  console.log(`wrote ${out} (${statSync(out).size} bytes)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
