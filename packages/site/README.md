# packages/site

The static portal and Atom feed. `renderSite(config, digests)` returns every page as a map of path to content; `writeSite` writes it out. The CLI runs it as `gitforage site --out DIR`.

- `src/html.ts`: the one HTML escaper, the `html` tagged template that applies it to every value, and the `href` check.
- `src/render.ts`: pages and cards, the Content-Security-Policy, Keep and Skip links.
- `src/feed.ts`: the Atom feed and its XML escaper.
- `assets/`: the stylesheet, the keyboard script and the icon, copied as they are.
