// Builds design/logos.html, the review page for the three logo concepts, from the SVG
// files in design/logos/. Not part of the generated site. Run: bun design/build-logos.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dir, "logos");
const CONCEPTS = [
  { id: "a-acorn", name: "A. Acorn", note: "An acorn whose cap carries a git branch that splits and merges back; the stem is HEAD. Provisional favicon and header mark." },
  { id: "b-mushroom", name: "B. Mushroom", note: "A mushroom whose spots are joined commits and whose stem holds a branch that rejoins the trunk, with mycelium below." },
  { id: "c-sprig", name: "C. Berry sprig", note: "A forager's sprig: the twig is the main line, side shoots are branches, and the berries are commit nodes." },
];
const strip = (svg: string) => svg.replace(/<title>[\s\S]*?<\/title>/, "").replace(/<style>[\s\S]*?<\/style>/, "");
const sized = (svg: string, px: number) => svg.replace("<svg ", `<svg width="${px}" height="${px}" aria-hidden="true" focusable="false" `);

const panel = (theme: "light" | "dark") => CONCEPTS.map((c) => {
  const big = strip(readFileSync(join(dir, `${c.id}.svg`), "utf8"));
  const small = strip(readFileSync(join(dir, `${c.id}-16.svg`), "utf8"));
  return `<section class="concept">
<h3>${c.name}</h3>
<div class="row">
<figure>${sized(small, 16)}<figcaption>16 (favicon cut)</figcaption></figure>
<figure>${sized(small, 32)}<figcaption>32</figcaption></figure>
<figure>${sized(big, 64)}<figcaption>64 (header)</figcaption></figure>
<figure class="tab"><span class="tab-chip">${sized(small, 16)} gitforage</span><figcaption>in a browser tab</figcaption></figure>
</div>
<figure class="huge">${sized(big, 512)}<figcaption>512 (social card)</figcaption></figure>
${theme === "light" ? `<p>${c.note}</p>` : ""}
</section>`;
}).join("\n");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gitforage logo concepts</title>
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<style>
body { margin: 0; font: 16px/1.5 system-ui, sans-serif; background: #f3ecdc; color: #241f17; }
header { padding: 1.5rem 1rem 0.5rem; max-width: 72rem; margin: 0 auto; }
h1 { font-family: Georgia, serif; margin: 0 0 0.25rem; }
.theme { padding: 1rem; }
.theme > h2 { max-width: 72rem; margin: 0 auto 0.75rem; font-family: Georgia, serif; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr)); gap: 1rem; max-width: 72rem; margin: 0 auto; }
.light { background: #fbf7ec; }
.dark { background: #111914; color: #ece5d3; }
.dark .o { stroke: #ece2c6; }
.dark .s { stroke: #b58a5c; }
.concept { border: 1px solid #d6c9ab; border-radius: 6px; padding: 0.75rem 1rem; }
.dark .concept { border-color: #344236; }
.concept h3 { margin: 0 0 0.5rem; }
.row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 1.25rem; }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; }
figcaption { font: 12px ui-monospace, monospace; opacity: 0.8; }
.huge svg { width: 100%; height: auto; max-width: 512px; }
.huge { margin-top: 0.75rem; }
.tab-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 8px 8px 0 0; background: #dfe3e8; color: #222; font-size: 13px; }
.dark .tab-chip { background: #2b2f33; color: #eee; }
</style>
</head>
<body>
<header>
<h1>gitforage logo concepts</h1>
<p>Three hand-built SVG emblems, each at 16, 32, 64 and 512 pixels, on paper and on the night-forest theme. Concept A is wired in as the provisional favicon and header mark. Source files: <code>packages/site/design/logos/</code>.</p>
</header>
<div class="theme light"><h2>Light (paper)</h2><div class="grid">
${panel("light")}
</div></div>
<div class="theme dark"><h2>Dark (night forest)</h2><div class="grid">
${panel("dark")}
</div></div>
</body>
</html>
`;
writeFileSync(join(import.meta.dir, "logos.html"), page);
console.log("wrote logos.html");
