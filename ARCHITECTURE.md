# gitforage architecture

gitforage finds GitHub projects you'd care about and tells you on a schedule. You describe your interests once in `interests.yml`, and it forages GitHub for four kinds of candidates:

1. **New repos** in your topics and keywords.
2. **Rising older repos:** established repos in your topics gaining stars fast, measured against star counts from earlier runs.
3. **Live forks** of projects you follow: forks that are ahead of upstream and recently pushed. These are often revived versions of dead projects.
4. **Kin of your stars:** repos that share the topics and words that are unusually common among your own stars (lift over GitHub as a whole, TF-IDF style).

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
packages/cli      gitforage preview | run | site | feedback
packages/site     static portal and Atom feed
packages/notify   ntfy, Telegram, webhooks, email (coming)
template/         what a portal repo starts from: interests.yml, feedback.yml,
                  the forage and feedback workflows
demo/             the public demo portal's interests
```

TypeScript, run with bun. Dependencies are kept minimal and pinned exactly.

## How people run it

1. Create a repo from `template/` (a "Use this template" button comes with the first release).
2. Edit `interests.yml`.
3. Turn on Pages with GitHub Actions as the source.

A scheduled workflow (weekly) forages in both modes, commits `state/` (seen repos, star counts and each run's digest), builds the portal and deploys it to Pages. The portal has Discover and Get involved tabs, topic pages, an archive, an About page and an Atom feed. Keep/Skip buttons on each card open a prefilled issue that a second workflow folds into `feedback.yml`, so feedback lives in git and no server is needed.

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
- **LLM** (optional, coming): re-ranks the top results against a plain-English profile. It works with an Anthropic key, any OpenAI-compatible endpoint, or local Ollama. Without one, gitforage is rules only.

## Security

All text from GitHub is untrusted. Names are validated, text is escaped, and the only links emitted are rebuilt from validated `owner/repo` names. The portal sends a strict Content-Security-Policy with no inline script, and escapes every dynamic string through one tested escaper. Workflows run with least-privilege permissions per job, actions and gitforage itself pinned by commit SHA, and issue text never placed in a shell script. Feedback issues are parsed with a strict pattern, and visitors are rate-limited and weigh less than owners. Tokens never appear in logs or output. See [SECURITY.md](SECURITY.md) to report a problem.

## Roadmap

1. Core + CLI (done).
2. Better candidates (done): kin from your own stars, rising older repos, popularity scaled within each topic, regex and keyword exclusions, and `feedback.yml` in the score.
3. Template repo, portal, Atom feed, feedback (done).
4. Optional LLM re-rank and notifiers.
5. Public v0.1 with a demo portal.
6. Later: GitLab and Codeberg sources, and a hosted version.
