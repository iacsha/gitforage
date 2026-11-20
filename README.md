# gitforage

gitforage finds GitHub projects you would care about before you hear of them. You describe your interests once in `interests.yml`, and it forages GitHub for:

1. **New repos** in your topics and keywords.
2. **Rising older repos:** established repos in your topics that are gaining stars fast right now.
3. **Live forks** of projects you follow: forks that are ahead of upstream and recently pushed. This is how you find a revived fork of a dead project.
4. **Kin of your stars:** repos that share the topics and words that are unusually common among your own stars.

Every candidate gets a fit score, and every score lists its reasons, so you can see why a repo is on the list ("3 of your topics, ~40 stars a month, top 10% in hl7, like your stars: hl7, mllp"). It ranks by fit to you, not by popularity, it remembers what it has already shown you, and your Keep and Skip marks move the ranking.

## Status

Milestones 1 to 3 are done:

- The core library and a command-line tool: kin learned from your own stars, rising older repos, popularity scaled within each topic, regex and keyword exclusions, and `feedback.yml` Keep/Skip marks feeding the score. Rules only, no LLM.
- A static portal (Discover and Get involved tabs, topics, an archive, an About page) with an Atom feed, built by `gitforage site`.
- Keep and Skip buttons on every card, folded into `feedback.yml` by `gitforage feedback`.
- A spoken-language filter, a star-farm guard, and Theme and Language buttons on the portal.
- A template repo (in [`template/`](template)) with two GitHub Actions workflows: a weekly forage that deploys the portal to GitHub Pages, and a feedback workflow.

It runs with [bun](https://bun.sh), on your machine or in GitHub Actions.

Coming, and not built yet:

- **Notifications:** ntfy, Telegram, Slack/Discord webhooks, email.
- **Optional LLM re-rank** against your `profile`.
- **A one-click template repo and a public demo portal**, with the first release.

Screenshots: coming with the public demo.

## Run your own

Your own portal takes about five minutes and needs no server and no paid key. Everything runs in GitHub Actions on your repo.

1. **Create the repo.** Make a new GitHub repo and copy the contents of [`template/`](template) into it, including the hidden `.github` folder. (With the first release this becomes a "Use this template" button.)
2. **Check the pinned version.** Both workflows run gitforage from a pinned commit: `GITFORAGE_SHA` near the top of `.github/workflows/forage.yml` and `feedback.yml`. A released template has it filled in. If you copied `template/` from `main`, set both to the gitforage commit you want to run. The workflows refuse to run with the all-zero placeholder.
3. **Describe your interests** in `interests.yml`: a few topics, some seeds, or your username in `stars_from`. The file is commented, and the full reference is [below](#interestsyml).
4. **Turn on Pages:** Settings, Pages, Source: **GitHub Actions**.
5. **Run it:** Actions, **forage**, Run workflow. When it finishes, your portal is at `https://<you>.github.io/<repo>/`. After that it runs every Sunday.
6. **Optional:** create a label named `gitforage-feedback` (Issues, Labels) so feedback issues get labelled. The title alone is enough for the workflow to find them.

No secrets are needed. The workflows use the repo's built-in `GITHUB_TOKEN`, with only the permissions each job needs.

### Why a pinned commit

The template does not install gitforage from a package registry or a moving tag. Each workflow checks out `iacsha/gitforage` at one full commit SHA, checks that it got exactly that commit, and installs its dependencies with `bun install --frozen-lockfile`, so every package is verified against the hashes in the committed `bun.lock`. A tag can be moved and a registry package can be replaced; a commit SHA cannot. To upgrade, change `GITFORAGE_SHA` on purpose. Dependabot keeps the pinned actions current, but it does not touch `GITFORAGE_SHA`.

## The portal

`gitforage site` builds a static site from the digests that `run` keeps in `state/digests/`:

- **Discover** (the home page): the latest discover-mode run, useful tools ranked by fit.
- **Get involved:** the latest contribute-mode run, with a maintainer line on each card (outside pull requests merged in 90 days, share of recent issues answered) when the run has that data.
- **Topics:** a page per topic in `interests.yml`, with everything listed for it so far.
- **Archive:** every past digest.
- **About:** what the portal looks for, how scoring works (with this portal's actual weights), how Keep and Skip work, and how to run your own.
- **`feed.xml`:** an Atom 1.0 feed with an entry per listed repo.

Each card shows the repo (linked to GitHub), its description, a source badge (**New**, **Rising**, **Live fork** or **Like your stars**), the top scoring reasons as chips, stars, language and last push, and Keep and Skip buttons. Keys: `j` and `k` move between cards, `Enter` opens one.

The site is plain HTML and CSS with two small same-origin scripts. It uses system fonts, works on a phone, and loads nothing from other hosts unless you turn on analytics.

Two buttons sit in the header:

- **Theme** cycles System, Light and Dark. System follows your device's setting. The choice is saved in your browser, and `assets/theme.js` applies it before the page paints, so there is no flash of the wrong theme.
- **Language** ("English only" by default when `filters.spoken_languages: [en]`) shows or hides cards in other languages. Each card carries its detected language. The default is the config's, and it holds without JavaScript, because the hiding is plain CSS set by the server. The choice is saved like the theme.

Both buttons stay hidden without JavaScript. If the browser blocks storage, the page still works and the choice lasts for that page.

**Analytics** are off by default. For cookieless visit counts with [GoatCounter](https://www.goatcounter.com), create a GoatCounter site and add `analytics: { provider: goatcounter, code: <your code> }` under `site:`. The script is loaded with a subresource integrity hash, and only GoatCounter's own origins are added to the Content-Security-Policy.

## Keep and Skip

The Keep and Skip buttons are links to a prefilled new issue on the portal's repo, titled `keep: owner/name` or `skip: owner/name`. Submitting it is the vote. The feedback workflow then:

1. reads the issue that triggered it and every other open issue, so none are missed when several arrive at once;
2. runs `gitforage feedback`, which checks each one and appends accepted marks to `feedback.yml`;
3. commits `feedback.yml`, replies on each feedback issue with what happened, and closes it.

Rules for a mark to count:

- The title must be exactly `keep: owner/name` or `skip: owner/name`. Nothing else in the issue is read.
- Bots are ignored.
- Owners, members and collaborators of the portal repo make **owner** marks. Anyone else makes **visitor** marks, unless `feedback.visitors` is `false`.
- Visitors need an account at least `feedback.min_account_age_days` old (30 by default), can add at most `feedback.max_per_user` marks a day (3), and can only mark repos the portal has listed.
- A visitor mark counts `feedback.visitor_weight` (0.25) of an owner mark, and only an owner's Skip hides a repo.

The reply never repeats the issue's title or body.

## Run it on your machine

```sh
git clone https://github.com/iacsha/gitforage
cd gitforage
bun install
cp interests.example.yml interests.yml    # then edit it
export GITHUB_TOKEN=...                   # any token; no scopes needed for public data
bun packages/cli/src/cli.ts preview
```

A token is strongly recommended. Without one, GitHub allows 60 requests an hour, which is not enough for a full run. `GH_TOKEN` works too. The token is only sent to `api.github.com`, in the `Authorization` header.

## Commands

```
gitforage preview  [--config interests.yml] [--mode discover|contribute] [--limit N] [--json] [--out preview.md] [--debug]
gitforage run      [--config interests.yml] [--mode discover|contribute] [--limit N] [--json] [--out digest.md] [--state state/seen.json]
                   [--feedback feedback.yml] [--debug]
gitforage site     [--config interests.yml] --out DIR [--repo owner/name] [--state state/seen.json]
gitforage feedback [--config interests.yml] [--event FILE] [--issues FILE] [--replies DIR] [--feedback feedback.yml] [--json]
```

- `preview` prints a ranked list: score, repo, stars, source, top reasons and link. It ignores the seen state and does not write it. With `--out` it writes markdown instead.
- `run` leaves out anything already in `state/seen.json`, prints a markdown digest (or writes it with `--out`), records what it reported in `state/seen.json`, records star counts in `state/stars.json` for rising repos, and keeps the list in `state/digests/<date>-<mode>.json` for the portal.
- `site` builds the portal from `state/digests/` into `--out`. `--repo` names the portal repo for the Keep and Skip links (the workflow passes its own repo).
- `feedback` reads issues as JSON: a GitHub `issues` event (`--event`), a list as the REST API returns it (`--issues`), or the `GITFORAGE_ISSUES_JSON` variable. It appends accepted marks to `feedback.yml` and, with `--replies DIR`, writes a reply per handled issue to `DIR/<number>.md`. Issues that do not look like feedback are left alone.
- Both read `feedback.yml` next to the config (or `--feedback FILE`) when it exists.
- `--mode` overrides `mode` from the config.
- `--json` gives every reason with its points, plus the fork, kin and signal details, the detected language (`lang`, `lang_confidence`) and any star-farm evidence.
- `--debug` lists every dropped repo and why on stderr ("dropped owner/name: written in Chinese (zh), not in filters.spoken_languages").
- `--no-cache` skips the response cache, `--cache-dir` moves it, `--quiet` silences progress and stats.

Progress and a summary go to stderr: how many candidates each source found, how many were dropped (and how many of those for language or a suspected star farm), how many API requests were made, how many came from the cache, and the time taken.

From the repo root, `bun run gitforage preview ...` is the same as `bun packages/cli/src/cli.ts preview ...`.

## interests.yml

See [`interests.example.yml`](interests.example.yml). You need at least one of `topics`, `keywords`, `seeds` or `stars_from`. Everything else has a default. Unknown keys are errors (with a "did you mean" hint), and every problem is reported at once.

| Key | Default | Meaning |
|---|---|---|
| `profile` | `""` | Free text about you. Not used by the rules; kept for the LLM re-rank (coming). |
| `topics` | `[]` | GitHub topics. Each one is a search for new repos, and matching topics add points. |
| `keywords` | `[]` | Phrases searched in name, description and README. |
| `seeds` | `[]` | Projects you follow, as `owner/repo`. Their live forks and kin are foraged. |
| `stars_from` | none | A GitHub user, normally you. Their stars count as already known (never shown), and they are what kin and affinity learn your profile from. |
| `exclude.topics` | `[]` | Drop repos with any of these topics. |
| `exclude.keywords` | `[]` | Drop repos whose `owner/name` or description contains any of these (case-insensitive). |
| `exclude.owners` | `[]` | Drop repos from these owners. |
| `exclude.patterns` | `[]` | Keywords and regexes on name, description and topics. See [Exclusion patterns](#exclusion-patterns). |
| `popularity` | `topic` | `topic` scores stars as a percentile within each of your interests; `global` uses raw counts. See [Popularity within topic](#popularity-within-topic). |
| `filters.min_stars` | `5` | Minimum stars for search and kin results. Forks are exempt. |
| `filters.max_age_days` | `365` | "New" means created within this many days. |
| `filters.languages` | `[]` | Programming languages (GitHub's language field). Empty means any. |
| `filters.spoken_languages` | `[]` | Languages of the description, as two-letter codes (`en`, `es`, `zh`, ...). Empty means any. See [Spoken languages](#spoken-languages). |
| `filters.drop_undetected` | `false` | With `spoken_languages` set, also drop repos whose language cannot be told (short or empty descriptions). |
| `filters.drop_suspected_star_farms` | `false` | Drop repos whose stars look inflated, instead of only lowering their score. See [Star-farm guard](#star-farm-guard). |
| `mode` | `discover` | `discover` to find useful tools, `contribute` to find projects to contribute to. Picks the weight preset. |
| `cadence` | `weekly` | `daily`, `weekly` or `monthly`. Stored only: the template workflow runs weekly, and you change its `cron` line to change that. |
| `digest_size` | `20` | Items per list, unless `--limit` is given. |
| `llm.provider` | `none` | `none`, `anthropic`, `openai-compatible` or `ollama`. Validated, but the re-rank is not built yet, so it is ignored. |
| `llm.model` | `""` | Model name for the LLM re-rank (coming). |
| `weights.*` | per mode | Override any scoring weight. See below. |
| `limits.*` | see below | API sampling caps. |
| `cache.ttl_hours` | `12` | How long cached API responses are reused. `0` turns the cache off. |
| `site.repo` | none | The portal repo, `owner/name`, for Keep and Skip links. The workflow passes it, so you rarely set it. |
| `site.title` | `gitforage` | The portal's name. |
| `site.url` | Pages URL | The public address, used in the feed. Defaults to `https://<owner>.github.io/<repo>/`. |
| `site.analytics` | off | `{ provider: goatcounter, code: <your code> }` for cookieless visit counts. |
| `feedback.visitors` | `true` | Accept Keep and Skip from people who are not owners or collaborators. |
| `feedback.visitor_weight` | `0.25` | How much a visitor mark counts next to an owner mark (0 to 1). |
| `feedback.max_per_user` | `3` | Most marks one person can add a day. Owners are not limited. |
| `feedback.min_account_age_days` | `30` | Visitor accounts younger than this are ignored. |

Archived and disabled repos are always dropped, as are your seeds and the repos `stars_from` has starred.

### limits

| Key | Default | Meaning |
|---|---|---|
| `search_per_query` | 30 | Results per search request (max 100). |
| `forks_per_seed` | 30 | Forks listed per seed, newest first and most-starred. |
| `fork_compares_per_seed` | 8 | Forks per seed compared against upstream. |
| `fork_max_push_age_days` | 180 | Forks not pushed within this many days are skipped before comparing. |
| `kin_terms` | 30 | Profile terms whose GitHub-wide count is looked up (one search each, cached 30 days). |
| `kin_queries` | 12 | Kin searches, one per pair of profile terms that occur together on your stars. |
| `kin_min_overlap` | 2 | A kin repo must carry this many of your profile terms. |
| `kin_max_stars` | 20000 | Kin repos above this many stars are skipped, since everyone already knows them. `0` means no cap. |
| `kin_max_push_age_days` | 180 | Kin searches only look at repos pushed within this many days. |
| `rising_per_query` | 30 | Results per rising search (one per topic and keyword). `0` turns the rising source off. |
| `rising_min_stars` | 50 | Rising repos need at least this many stars. |
| `rising_min_growth` | 10 | Rising repos must gain this many stars a month, and at least 1% of their stars. |
| `rising_push_days` | 30 | Rising repos must have been pushed within this many days. |
| `stars_from_max_pages` | 3 | Pages of 100 read from `stars_from`. |
| `signals_top` | 15 | Activity signals are fetched for this many top candidates only. |

## Sources

| Source | How | Cost |
|---|---|---|
| New | One search per topic and keyword: `created:>=<max_age_days ago> stars:>=<min_stars>`, sorted by stars. | 1 search request each |
| Rising | One search per topic and keyword for older repos: `created:<<max_age_days ago> pushed:>=<rising_push_days ago> stars:>=<rising_min_stars>`. Kept when their measured growth qualifies (see below). | 1 search request each |
| Live forks | List forks (newest and most-starred), drop forks never pushed since forking or quiet for `fork_max_push_age_days`, then compare the freshest against upstream for `ahead_by`. | 1 request for the seed, 2 for the lists, 1 per compare |
| Kin of stars | Learn a term profile from your stars and seeds, then search pairs of terms that occur together on your stars. | 1 search per term (cached 30 days), 1 per seed README, 1 search per pair |
| Signals | For the top `signals_top` candidates only, and only the signals the current mode gives weight to. Plus a contributors list for repos with 2,000+ stars, for the star-farm guard. | 0 to 7 per candidate |

### Kin of your stars

gitforage learns what you care about from your own stars (`stars_from`) and your seeds. Every repo becomes a set of terms: its topics and the words of its name and description. Seed READMEs are read too, but README words only strengthen a term that topics or descriptions already show, since READMEs are full of words like "started" and "license". A term needs at least two of your repos behind it.

Each term is then weighted by how characteristic it is of you, TF-IDF style:

- `p` is the share of your profile repos that carry it (seeds count double).
- `g` is the share of GitHub that matches it: one search for the term, divided by an estimate of 300 million repos. These counts change slowly, so they are cached for 30 days.
- `lift = p / g`, and the weight is `p * log10(lift)`, scaled so your strongest term is 1.

So `docker` on many of your stars weighs little, because millions of repos carry it, while `hl7` on a handful weighs a lot. Kin searches pair up the strongest terms that occur together on your stars (`"hl7" "mllp"`, each term in at most three pairs) and keep results that carry at least `kin_min_overlap` of your terms.

Every candidate, from any source, also gets an **affinity**: the sum of the weights of your profile terms it carries. That is the lift-based score: a repo scores for being unusual in the way your stars are unusual, not for being popular. A repo that went viral this week but shares nothing with your stars gets no affinity and is never kin.

Why not "people who starred your seeds also starred": GitHub no longer shows the stargazer lists of other people's repos (REST returns 404, GraphQL an empty list). Milestone 1 sampled seed contributors and fork owners instead. On a real config that cost about 130 of 220 requests and found 4 kin, 2 of them viral repos unrelated to the config. The term-based kin, on the same config, found over 200 candidates for 12 searches (plus 30 term counts, cached for a month). Its top results were all on-topic, it found the better of the two on-topic people-sampled hits (a 2,400-star FHIR library) and missed the other (an 11-star repo with no topics), and neither viral repo appeared anywhere in the 200 best. So the people-sampling fallback was removed.

### Rising older repos

"Stars divided by age" means nothing for a five-year-old repo, and GitHub has no cheap "stars gained this month" for repos you do not own (their stargazer timestamps are hidden too). So gitforage measures growth itself: `run` records the star count of every candidate it looks at in `state/stars.json`, and on a later run growth is `(stars now - stars then) / days between`, scaled to a month. A baseline is kept for at least 6 days, so two runs on the same day do not erase it, and entries not seen for 180 days are dropped. A repo is rising when it gains at least `rising_min_growth` stars a month and at least 1% of its stars a month. The first run only records counts and finds no rising repos; from the second weekly run on, the source works. Any older candidate with a baseline also gets the `star_growth` rule.

### Popularity within topic

Raw star counts favour whatever is big everywhere. With `popularity: topic` (the default), a candidate's popularity is its percentile among this run's candidates that share one of your topics or keywords with it (or, failing that, its strongest profile term). Young repos are compared on stars a month and older ones on total stars, each only with their own kind. The best percentile across its groups counts. So a 50-star HL7 repo at the top of the hl7 pool earns the same popularity points as a 5,000-star repo at the top of a generic pool, and fit decides between them. The reason says where it stands: "50 stars, top 25% in hl7".

### Exclusion patterns

`exclude.patterns` takes plain keywords and regexes, matched against the name (`owner/repo`), the description and each topic. A plain string is a case-insensitive keyword in all three. A mapping takes exactly one of `keyword:` or `regex:`, and an optional `in: [name, description, topics]`. Regexes are case-insensitive. Because they run against text from strangers' repos, regexes longer than 200 characters, with backreferences or lookarounds, or with nested quantifiers such as `(a+)+` are refused when the config is loaded. See the commented example in [`interests.example.yml`](interests.example.yml), which shows how to drop crypto giveaway and game-cheat spam. Nothing is excluded by default beyond what you list.

### Spoken languages

gitforage guesses the human language of each candidate from its description, with no dependency and no extra API calls:

1. **Script.** It counts the letters of each Unicode script: Han, kana, Hangul, Cyrillic, Arabic, Hebrew, Devanagari, Thai, Greek and others. Han, kana and Hangul count three times, since one character is about a word. Capitalised acronyms (FHIR, MCP) are left out, because they are the same in every language. If a non-Latin script has the most weight, it names the language (kana on top of Han means Japanese).
2. **Latin script.** A small stopword vote decides between English and Spanish, Portuguese, French, German, Italian, Dutch, Turkish, Indonesian and Vietnamese, helped by letters only some of them use (ñ, ã, ß, ğ, ơ). Words in capitals do not vote, so "Proxmox VE" is not Turkish and "MIT licensed" is not German.

The result is a code and a confidence, such as `{ lang: "zh", confidence: 0.63 }`. Text that is too short, or where English ties with another language, is `und` (undetermined). So one Chinese word in an English sentence stays English, and a Chinese description with one English sentence after it is Chinese. Topics are not used: they are ASCII slugs such as `proxmox-ve` or `bluetooth-le` that read as Turkish or French once split.

With `filters.spoken_languages: [en]`, repos in other languages are dropped with a reason ("written in Chinese (zh), not in filters.spoken_languages"). Undetermined repos stay unless `filters.drop_undetected: true`, because many English descriptions are short fragments ("Self-hosted photo management") with no function words to vote.

### Star-farm guard

Bought or botted stars come without what real users bring: forks, issues and contributors. They also come fast. gitforage checks every candidate against what it already has (the repo's stars, forks, open issues, size and age, and growth since an earlier run) and, for the top `signals_top` repos with 2,000 stars or more, one contributors request.

| Check | Strength |
|---|---|
| 150,000 stars or more within its first year (only a few dozen repos in GitHub's history have that many at all) | strong |
| 150 or more stars per fork, with at least 1,000 stars | strong |
| At most one contributor, with at least 10,000 stars | strong |
| Under a year old and 25,000 stars a month (50,000+ stars), or under 90 days old and 2,500 a month (5,000+ stars) | weak |
| 40 or more stars per fork | weak |
| At most two open issues and pull requests, with at least 5,000 stars | weak |
| At most two contributors, with at least 2,000 stars | weak |
| Under 200 KB of code, with at least 5,000 stars | weak |
| A sudden spike: 3,000+ stars a month since the last run, five times the lifetime average | weak |

One strong check, or two weak ones, flags the repo. When the repo has plenty of forks (under 10 stars per fork), weak checks need a third to agree, since forks are real use. Forks found as live forks are never checked.

A flagged repo loses `star_farm` points (-8) with the evidence as its reason, such as "stars look inflated: 470k stars in 7 months" or "stars look inflated: 5.2k stars, 9 forks, 1 open issue". With `filters.drop_suspected_star_farms: true` it is dropped instead, with the same reason in `--debug`. The demo portal drops them.

### Rate limits and caching

- Every response's `x-ratelimit-*` headers are tracked per resource (core and search). When a bucket is empty, gitforage waits for its reset instead of collecting 403s.
- Search requests are spaced to 30 a minute (10 without a token).
- On 403 or 429 it honours `retry-after`, then the reset time, and falls back to exponential backoff from 60 seconds for secondary limits. Server errors get a short backoff. A wait longer than 15 minutes stops the run with a clear message.
- Responses are cached under `.gitforage/cache` next to the config, for `cache.ttl_hours`. A rerun inside the TTL makes no requests.

A cold run of a real config (7 topics, 2 keywords, 5 seeds, `stars_from` with 61 stars) made 139 requests in 121 seconds in discover mode, about a minute of it waiting on the search limit, since most requests are searches. Contribute mode straight after made 62 more in 19 seconds. Milestone 1 needed 220 requests for discover on a similar config, most of them for people-sampling kin. A rerun from the cache takes about 2 seconds, and the term counts behind the profile stay cached for 30 days.

## How scoring works

Each rule adds points and a reason. The score is the sum. A weight of 0 turns a rule off, and signals that only feed zero-weight rules are not fetched at all. Set any weight under `weights:` to override the mode's preset.

| Rule | discover | contribute | Points |
|---|--:|--:|---|
| `topic_match` | 3 | 3 | per interest topic the repo carries or was found by, up to 3 |
| `keyword_match` | 2 | 2 | per keyword in name or description, or found by keyword search, up to 3 |
| `star_velocity` | 3 | 2 | times log10(1 + stars per month), capped at 2.5, for repos younger than `max_age_days` |
| `stars` | 1.5 | 1 | times log10(1 + stars), capped at 4, for older repos |
| `star_growth` | 2 | 1.5 | times log10(1 + stars gained a month), capped at 2.5, for older repos with an earlier observation |
| `recent_push` | 3 | 3 | full within 7 days, 2/3 within 30, 1/3 within 90 |
| `stale_push` | -3 | -3 | no push for over a year |
| `release` | 2 | 1 | latest release within 90 days; half within a year |
| `license` | 1 | 1 | a license is detected |
| `readme` | 1.5 | 1 | a third each for a README file, a description, and a homepage |
| `affinity` | 2 | 1.5 | times the summed weight of your profile terms it carries (top 5), capped at 3 |
| `star_farm` | -8 | -8 | the stars look inflated (see [Star-farm guard](#star-farm-guard)) |
| `feedback` | 1 | 1 | times (2 x topic nudge + owner nudge + language nudge) from your Keep/Skip marks |
| `fork_ahead` | 1 | 2 | times log2(1 + commits ahead of upstream), capped at 5 |
| `outside_prs` | 0 | 1 | per PR merged from outside contributors in the last 90 days, up to 5 |
| `issue_response` | 0 | 3 | times the share of recent issues (over 2 days old) that got a reply or were closed |
| `contributing` | 0 | 1 | a CONTRIBUTING file |
| `good_first_issue` | 0 | 1.5 | open issues labelled "good first issue" or "help wanted" |

Star velocity is stars divided by age, which is cheap and only meaningful for young repos. With `popularity: topic` (the default), `star_velocity` and `stars` use the percentile within topic instead of the log: the weight times the cap times the percentile. Popularity is capped either way so it cannot outweigh fit.

"Outside" contributors are those GitHub marks as `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, `FIRST_TIMER` or `NONE`, not counting bots.

Ties are broken by stars, then by name, so output is deterministic for the same data.

## State and feedback

`gitforage run` keeps `state/seen.json` next to the config (or at `--state`). It maps each reported `owner/repo` to the date it was first shown and its score then. Beside it, `state/stars.json` holds the star counts used for growth, and `state/digests/` holds each run's list. Keys are sorted so the files diff cleanly in git. `preview` never writes them; it reads `stars.json` so growth shows up. A second `run` on the same day and mode adds to that day's digest instead of replacing it. Running discover and then contribute with the same state, as the template does, lists each repo once, in the first mode that ranks it.

`feedback.yml` holds your Keep and Skip marks:

```yaml
version: 1
marks:
  - { repo: owner/name, mark: keep, date: 2026-11-29, topics: [hl7, fhir], language: Java }
  - { repo: other/name, mark: skip, date: 2026-11-29, topics: [spamlist], language: Kotlin }
```

Marks that come in through the portal also carry `from: visitor` or `from: owner`, and `by: <login>`. A mark without `from` is yours. Your latest mark per repo counts, and a repo you skipped is never shown again. Each visitor's latest mark per repo counts `feedback.visitor_weight` of one of yours, and a visitor's Skip only nudges. Marks add up per topic, per owner and per language into a nudge between -1 and 1 (`tanh(net / 2)`: one mark moves things a little, three most of the way), and the `feedback` rule adds `weight x (2 x topic nudge + owner nudge + language nudge)`, where the topic nudge is the mean over the repo's topics that have one. Topics and language are stored with the mark, because they are what the nudges are keyed on. You can add marks by hand too.

## Security

gitforage handles two kinds of untrusted input: text from strangers' repos, and Keep/Skip issues from anyone on GitHub.

**On the portal**, every page carries a strict Content-Security-Policy (`default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'`, plus GoatCounter's origins only if you turn analytics on). There is no inline script, no inline style and no style attribute. The theme script that runs before paint is a separate same-origin file, not an inline snippet, so the policy needs no `unsafe-inline`. The scripts only read and write two fixed `localStorage` keys inside `try`, accept only known values from them, and never write markup. A card's `data-lang` is checked against the fixed list of language codes before output. Every dynamic string goes through one HTML escaper, applied automatically by the page templates, and every link is checked to be a GitHub link rebuilt from a validated name or a relative link inside the site. Digest files are validated again when the site is built, as if a stranger had written them. The tests render descriptions full of `<img onerror>`, `javascript:`, quote-breaking attributes and bidi characters and check that the output is inert. The Atom feed has its own XML escaper.

**In the workflows**, every action is pinned by a full commit SHA, and gitforage itself by a full commit SHA. Each job gets only the permissions it needs: the forage job can write repo contents, the deploy job can publish Pages, the feedback job can write contents and issues. There is no `pull_request_target`, checkouts do not keep credentials, and no `${{ }}` expression is placed inside a `run:` script: issue data reaches gitforage only as JSON files, and only fixed values go through `env:`. Tests check these rules on every workflow.

**Feedback issues** are matched against a strict title pattern, and nothing else in them is read or echoed. Bots, young accounts and repos the portal never listed are refused, visitors are rate-limited and weigh less than owners, and a visitor cannot hide a repo.

**Everywhere else,** all text from the GitHub API is treated as untrusted. Repo names must be plain `owner/repo`; anything else is dropped. Control and bidi characters are stripped, markdown and HTML are escaped, and the only links emitted are `https://github.com/<owner>/<repo>` rebuilt from a validated name. Profile terms are reduced to `[a-z0-9+#-]` tokens before they go into a search query. Exclusion regexes with shapes that can backtrack badly are refused. `feedback.yml`, `state/seen.json` and `state/stars.json` are validated entry by entry. Cache files are named by a hash of the request URL. The token is redacted from errors and logs. See [SECURITY.md](SECURITY.md) to report a problem.

## Dependencies

| Package | Kind | Why |
|---|---|---|
| [`yaml`](https://www.npmjs.com/package/yaml) 2.9.1 | runtime | Parses `interests.yml` with line and column errors, a safe core schema and alias limits. No dependencies of its own. |
| [`typescript`](https://www.npmjs.com/package/typescript) 7.0.2 | dev | `bun run typecheck`. |
| [`@types/bun`](https://www.npmjs.com/package/@types/bun) 1.4.5 | dev | Types for bun's APIs. |

GitHub is reached with plain `fetch`. Versions are pinned exactly, and `bun.lock` is committed.

## Development

```sh
bun install
bun test             # no network: tests use fake API responses
bun run typecheck
```

Layout:

```
packages/core    sources, scoring, state, sanitising, the GitHub client
packages/cli     the gitforage command
packages/site    static portal and Atom feed
packages/notify  notifiers (coming)
template/        what a portal repo starts from: interests.yml, feedback.yml, workflows
demo/            the public demo portal's interests
scripts/         release helpers (pin-template.ts)
```

## Releasing

The template ships with an all-zero `GITFORAGE_SHA`. On the commit being released, run `bun scripts/pin-template.ts <commit SHA>` to pin both template workflows to it.

## License

MIT. See [LICENSE](LICENSE).
