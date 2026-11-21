# interests.yml

See [`interests.example.yml`](../interests.example.yml). You need at least one of `topics`, `keywords`, `seeds` or `stars_from`. Everything else has a default. Unknown keys are errors (with a "did you mean" hint), and every problem is reported at once.

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
| `exclude.patterns` | `[]` | Keywords and regexes on name, description and topics. See [Exclusion patterns](sources-and-scoring.md#exclusion-patterns). |
| `popularity` | `topic` | `topic` scores stars as a percentile within each of your interests; `global` uses raw counts. See [Popularity within topic](sources-and-scoring.md#popularity-within-topic). |
| `filters.min_stars` | `5` | Minimum stars for search and kin results. Forks are exempt. |
| `filters.max_age_days` | `365` | "New" means created within this many days. |
| `filters.languages` | `[]` | Programming languages (GitHub's language field). Empty means any. |
| `filters.spoken_languages` | `[]` | Languages of the description, as two-letter codes (`en`, `es`, `zh`, ...). Empty means any. See [Spoken languages](sources-and-scoring.md#spoken-languages). |
| `filters.drop_undetected` | `false` | With `spoken_languages` set, also drop repos whose language cannot be told (short or empty descriptions). |
| `filters.drop_suspected_star_farms` | `false` | Drop repos whose stars look inflated, instead of only lowering their score. See [Star-farm guard](sources-and-scoring.md#star-farm-guard). |
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
| `site.tag` | none | Optional short label beside the name, like `beta`. Lowercase letters, digits, spaces and hyphens, at most 16. |
| `site.url` | Pages URL | The public address, used in the feed. Defaults to `https://<owner>.github.io/<repo>/`. |
| `site.analytics` | off | `{ provider: goatcounter, code: <your code> }` for cookieless visit counts. |
| `site.layout.density` | `comfortable` | The default card layout: `comfortable`, `compact` (smaller text, more tiles) or `list` (one row per repo). See [Layout](portal.md#layout). |
| `site.layout.sort` | `score` | The default order: `score`, `newest`, `stars` or `rising`. |
| `site.layout.fields` | all `true` | Which card fields show by default: `{ reasons, health, language, stars }`, each `true` or `false`. |
| `site.personalize.enabled` | `false` | The Discover page's "Pick your topics" panel. See [Pick your topics](portal.md#pick-your-topics). |
| `site.personalize.catalog.groups` | `[]` | The picker's groups: `{ name, topics }`, at most 24. Names are plain text up to 60 characters. |
| `site.personalize.catalog.topics` | `[]` | More catalog topics, shown under "More topics" with your own `topics`. At most 150 catalog topics in all. |
| `site.personalize.catalog.per_topic` | `25` | Candidates kept per topic in `catalog.json` (1 to 100), lowered automatically to fit the size budget. |
| `site.personalize.packs` | `[]` | Starter packs: `{ id, name, topics }`, at most 24, topics from the catalog. |
| `feedback.visitors` | `true` | Accept Keep and Skip from people who are not owners or collaborators. |
| `feedback.visitor_weight` | `0.25` | How much a visitor mark counts next to an owner mark (0 to 1). |
| `feedback.max_per_user` | `3` | Most marks one person can add a day. Owners are not limited. |
| `feedback.min_account_age_days` | `30` | Visitor accounts younger than this are ignored. |
| `revival.enabled` | `false` | The Revival radar: in your topics, upstreams that are archived or have not been pushed for `dormancy_months`, carried on by a fork that is ahead of upstream, pushed in the last 180 days and has some traction. Shown on `revival.html` (the Revivals tab). Needs `topics`. |
| `revival.dormancy_months` | `12` | No push for this many months (3 to 120), or archived, counts as dormant. |
| `revival.max_candidates` | `10` | Upstreams examined afresh per run (1 to 50). Each costs at most 5 API calls; a check is reused from `state/revival.json` for 28 days. |
| `revival.min_fork_stars` | `5` | Stars a fork needs to count as carrying the project (3 open issues of its own also count). |

Archived and disabled repos are always dropped, as are your seeds and the repos `stars_from` has starred.

## limits

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
