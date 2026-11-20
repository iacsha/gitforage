# packages/site

The static portal and Atom feed. `renderSite(config, digests)` returns every page as a map of path to content; `writeSite` writes it out. The CLI runs it as `gitforage site --out DIR`.

- `src/html.ts`: the one HTML escaper, the `html` tagged template that applies it to every value, and the `href` check.
- `src/render.ts`: pages and cards, the Content-Security-Policy, Keep and Skip links.
- `src/feed.ts`: the Atom feed and its XML escaper.
- `src/personalize.ts`: catalog.json and the markup for "Pick your topics" (site.personalize).
- `assets/`: the stylesheet, the scripts and the icon, copied as they are. `personalize-core.js` (pure functions, imported by the tests as is) and `personalize.js` (the dialog and cards) ship only with personalization on. `assets/og-card.png` is the 1200x630 social card every page names in its `og:image` tag (only when `site.url` is set, since the tag needs an absolute URL). It is committed; redraw it with `CHROME=/path/to/chrome-headless-shell bun scripts/og-card.ts` after changing the emblem or the palette.
