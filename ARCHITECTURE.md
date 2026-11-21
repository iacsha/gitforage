# gitforage architecture

gitforage finds GitHub projects you'd care about and tells you on a schedule. You describe your interests once in `interests.yml`, and it forages GitHub for four kinds of candidates:

1. **New repos** in your topics and keywords.
2. **Rising older repos:** established repos in your topics gaining stars fast, measured against star counts from earlier runs.
3. **Live forks** of projects you follow: forks that are ahead of upstream and recently pushed. These are often revived versions of dead projects.
4. **Kin of your stars:** repos that share the topics and words that are unusually common among your own stars (lift over GitHub as a whole, TF-IDF style).

With `revival.enabled`, a fifth list sits beside them: the **Revival radar** (the Revivals tab). It searches your topics for upstreams that are archived or have not been pushed for `revival.dormancy_months`, and for each looks for a fork that carries it on: ahead of upstream (`compare` ahead_by, so mirrors are rejected), pushed in the last 180 days, with stars or issues of its own, and past the exclusions and the star-farm guard. Renames and transfers (a fork that is the upstream itself, or older than it) are ignored, and an upstream whose homepage or description names the fork is labelled "upstream points here". It reuses the wild-fork pieces (the forks listing, `isLiveFork`, the compare call). A run makes at most `2 x topics (max 12) + 5 x revival.max_candidates` calls, and `state/revival.json` keeps each check for 28 days, so weekly runs re-examine an upstream about once a month.

Each candidate gets a fit score with human-readable reasons, and digests only carry things you haven't seen before.

It is not a trending list. Trending sites rank by popularity. gitforage ranks by fit to you and remembers what it has already shown you.

## Modes

- **discover** (default): useful tools. Ranks on fit, adoption, recent activity, releases and license.
- **contribute:** projects to get involved in. Also weighs maintainers who merge outside PRs, issue response, starter issues, and live forks.

## Packages

```
packages/core     interests.yml schema, GitHub client (cache, rate limits),
                  sources (new, rising, forks, kin), the star profile, scoring
                  rules with reasons, popularity within topic, spoken-language
                  detection, the star-farm guard, exclusions and
                  patterns, feedback.yml, seen and star-count state,
                  sanitising of untrusted text
                  run digests, feedback intake from Keep/Skip issues
                  the revival radar (dormant upstream, live fork)
                  the early-finds ledger (Trending, HN, star milestones)
packages/cli      gitforage preview | run | site | feedback | notify | early-finds
packages/site     static portal (density, sort and filters, the topic picker
                  and catalog.json) and Atom feed
packages/notify   notifiers: ntfy, Telegram, webhooks (JSON, Slack, Discord)
template/         what a portal repo starts from: interests.yml, feedback.yml,
                  the forage and feedback workflows
demo/             the public demo portal's interests
```

TypeScript, run with bun. Dependencies are kept minimal and pinned exactly.

## How people run it

1. Create a repo from `template/` (a "Use this template" button comes with the first release).
2. Edit `interests.yml`.
3. Turn on Pages with GitHub Actions as the source.

A scheduled workflow (weekly) forages in both modes, commits `state/` (seen repos, star counts and each run's digest), builds the portal and deploys it to Pages. The portal has Discover and Get involved tabs, topic pages, an archive, an About page, a Backtest (simulated) page, a Found early page (`early-finds/`, the live record kept apart from the backtest: finds the portal showed before they reached GitHub Trending, the Hacker News front page or a star milestone, from `state/early-finds.json`, which a daily `early-finds` workflow keeps when `early_finds.enabled` is on) and an Atom feed. The Haul (`haul/`) is a numbered weekly issue of the week's three best new finds, derived from `state/digests/` on every build (no state of its own), with its own Atom feed for RSS-to-email and optional one-line notes from `haul.txt`. Every page carries Open Graph and Twitter card tags; the image and page URL are added when `site.url` is set. Keep/Skip buttons on each card open a prefilled issue that a second workflow folds into `feedback.yml`, so feedback lives in git and no server is needed. With `site.personalize`, discover runs also forage a bigger topic catalog into `state/catalog.json`, and the Discover page lets each visitor re-rank it for their own topics in their browser.

Both workflows run gitforage from a pinned commit SHA, installed from its lockfile.

```
schedule ──> forage job (contents: write)
               gitforage run --mode discover    ─┐
               gitforage run --mode contribute  ─┼─> state/  ──> commit
               gitforage site                   ─┘    └─> site/ ──> deploy job (pages: write) ──> GitHub Pages

issue "keep: owner/name" ──> feedback job (contents: write, issues: write)
               gitforage feedback (strict title, rate limits) ──> feedback.yml ──> commit, reply, close
```

## Scoring

- **Rules** (always on): every rule adds points plus a reason ("3 of your topics", "~40 stars a month", "merged 6 outside PRs"). Users can override the weights in `interests.yml`.
- **Affinity:** every candidate is scored on how characteristic of your stars its terms are, not on raw popularity.
- **Popularity within topic:** stars and stars a month count as a percentile among the candidates that share an interest, so a niche leader is not drowned by big generic repos.
- **Language and star farms:** each candidate's description language is detected without a dependency, and `filters.spoken_languages` drops other languages. Repos whose stars are implausible for their forks, issues, contributors and age lose points or are dropped.
- **Feedback:** Keep/Skip marks in `feedback.yml` nudge per-topic, per-owner and per-language weights, and a skipped repo is never shown again.
- **LLM** (optional): judges the top `llm.top` results against your plain-English `profile`, adding at most `llm.weight` points either way plus a one-sentence "AI field note". It works with an Anthropic key, any OpenAI-compatible endpoint, or local Ollama, and any failure leaves the rule ranking unchanged. Without one, gitforage is rules only.

## Security

All text from GitHub is untrusted. Names are validated, text is escaped, and the only links emitted are rebuilt from validated `owner/repo` names. The portal sends a strict Content-Security-Policy with no inline script, and escapes every dynamic string through one tested escaper. Workflows run with least-privilege permissions per job, actions and gitforage itself pinned by commit SHA, and issue text never placed in a shell script. Feedback issues are parsed with a strict pattern, and visitors are rate-limited and weigh less than owners. Tokens never appear in logs or output. See [SECURITY.md](SECURITY.md) to report a problem.

## Roadmap

1. Core + CLI (done).
2. Better candidates (done): kin from your own stars, rising older repos, popularity scaled within each topic, regex and keyword exclusions, and `feedback.yml` in the score.
3. Template repo, portal, Atom feed, feedback (done).
   - 3.5 Customizable layout (done): Comfortable, Compact and List densities, card field switches, sort (score, newest, stars, rising) and source and topic filter chips, with defaults from `site.layout`.
   - 3.6 Personalize in the browser (done): a topic catalog with groups and starter packs, re-ranked in the visitor's browser; "Use my GitHub stars" (the visitor's browser asks GitHub directly); local Keep and Skip; shareable `?t=` links; GoatCounter pick events when analytics are on. The default view and the JavaScript-off page are unchanged.
4. Optional LLM re-rank (done) and notifiers.
5. Public v0.1 with a demo portal.
6. Later: GitLab and Codeberg sources, and a hosted version.
