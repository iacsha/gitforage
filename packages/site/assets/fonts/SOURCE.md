# Heading font: Fraunces (field-guide cut)

- **File:** `fraunces-fieldguide.woff2` (30,192 bytes)
- **SHA-256:** `27355e283701c75cc3be820706a5da2edba79390f2e6ef1694c6263e973a1d06`
- **Family:** Fraunces, by Undercase Type, Phaedra Charles and Flavia Zimbardi
- **License:** SIL Open Font License 1.1 (`OFL.txt`, published with the site as `assets/fonts/ofl.txt`). No Reserved Font Name is declared.
- **Upstream:** `https://github.com/google/fonts/raw/main/ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf`
  at google/fonts commit `4024282d9b0cffcdb8e3024560862746178d741f` (last change to `ofl/fraunces`, 2026-02-27)
- **Upstream TTF SHA-256:** `177ff6c0f14e5550a3c624247cd1189611d4eb65d000b14944c63d967958abbb`
- **Version:** VERSION 1 of this cut (2026-11-20)

## How it was cut

Subset with harfbuzz (`subset-font` 2.4.0, run with bun), output woff2:

- **Characters:** Basic Latin U+0020 to U+007E, plus no-break space, middle dot, copyright,
  degree, é è à ö ü ñ, curly quotes, en dash, ellipsis, bullet and the numero sign.
- **Axes:** `wght` kept variable from 400 to 700; `opsz` pinned at 72; `SOFT` pinned at 50;
  `WONK` pinned at 1 (the leaning n, m and h that give it the old botanical-plate feel).

It is served from the portal's own origin (`font-src 'self'`); nothing loads from a font CDN.
