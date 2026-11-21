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
| `llm.provider` | `none` | `none`, `anthropic`, `openai-compatible` or `ollama`. See [AI re-rank](#ai-re-rank-optional). |
| `llm.model` | per provider | `claude-opus-5-5` for `anthropic`, `llama3.1` for `ollama`; required for `openai-compatible`. |
| `llm.base_url` | `""` | Endpoint for `openai-compatible` (required) or `ollama` (default `http://localhost:11434`). `https://`, or `http://` to localhost only. |
| `llm.top` | `20` | How many of the rule-ranked top results the model judges (1 to 50). |
| `llm.weight` | `4` | Most points the model can add or take away (0 to 20). `0` keeps the notes but leaves the ranking alone. |
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
| `notify.*` | off | A short message after each run, to ntfy, Telegram or a webhook. See [Notifications](#notifications). |
| `early_finds.enabled` | `false` | Keep `state/early-finds.json` (daily, with the `early-finds` workflow) and build the Found early page from it: finds this portal showed before they reached GitHub Trending, the Hacker News front page or a star milestone. See [Found early](portal.md#found-early). |

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

## AI re-rank (optional)

Rules always run first. With `llm.provider` set, gitforage then sends the top `llm.top` results (name, description, topics, language, stars and their top reasons) plus your `profile` to the model, and asks for a fit from 0 to 10 and a one-sentence field note for each. A fit adds `weight x (fit - 5) / 5` points, so the model can move a repo by at most `llm.weight` either way, and the reason line says so ("AI fit 8/10"). The note appears on the card labelled **AI field note**, beside the rule-written note.

| Provider | Key (environment only) | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Messages API with structured JSON output, low effort. Set `llm.model` to `claude-haiku-5-5` for the cheapest run. |
| `openai-compatible` | `OPENAI_API_KEY` (optional) | Any `/chat/completions` endpoint at `llm.base_url`. |
| `ollama` | none | Local Ollama at `llm.base_url`. |

Keys are never read from `interests.yml`. In the template workflow, add the key as a repository secret with the same name; without it the run stays rules-only. Answers are cached for 7 days next to the API cache, so a rerun costs nothing. Any failure (no key, a network error, a reply that is not the expected JSON, a refusal) is a warning, and the rule ranking stands.

The model only ever sees public repo data and your profile text. Repo text is passed as a quoted data block and the model is told not to follow instructions in it. Its reply is validated (known ids, a 0 to 10 fit), and the note is cleaned, stripped of URLs, capped at 200 characters and escaped like any other repo text. A prompt injection in a README can at worst move that one repo by `llm.weight` points and give it an odd note.

## Notifications

After a run, `gitforage notify` can send one short message: the date, the top finds of each mode (name, score and top reason, each linked to its GitHub page) and a link to the portal. The template workflow runs it after the state is committed, as an optional step that can never block the deploy.

```yaml
notify:
  top: 5                            # finds per mode in the message, 1 to 20
  channels: [ntfy, telegram, webhook]
  webhook_format: json              # json, slack or discord
  ntfy_server: https://ntfy.sh      # or your own ntfy server (https only)
```

| Key | Default | Meaning |
|---|---|---|
| `notify.top` | `5` | Finds per mode in the message (1 to 20). |
| `notify.channels` | `[]` | Any of `ntfy`, `telegram` and `webhook`. Empty sends nothing. |
| `notify.webhook_format` | `json` | The webhook's payload: `json` (structured, below), `slack` (an incoming webhook's `text`) or `discord` (a webhook's `content`). |
| `notify.ntfy_server` | `https://ntfy.sh` | The ntfy server. Must be `https://`, with no credentials, query or fragment. |

**Secrets never go in `interests.yml`.** Each channel reads them from environment variables, which the template workflow fills from repository secrets (Settings, Secrets and variables, Actions):

| Channel | Variables |
|---|---|
| `ntfy` | `GITFORAGE_NTFY_TOPIC`, and `GITFORAGE_NTFY_TOKEN` for a protected topic (sent as a bearer token). On the public ntfy.sh the topic name is the password, so pick a long random one. |
| `telegram` | `GITFORAGE_TELEGRAM_BOT_TOKEN` (from @BotFather) and `GITFORAGE_TELEGRAM_CHAT_ID` (a numeric chat id or `@channelname`). |
| `webhook` | `GITFORAGE_WEBHOOK_URL`, an `https://` URL. Slack and Discord webhook URLs carry their token, so treat the URL as a secret. |

A channel in `notify.channels` whose variables are not set is skipped with a warning, so you can list a channel before adding its secret. A variable that is set but malformed, or a request that fails, counts as a failure: `gitforage notify` exits 1 and the workflow step shows it, but the portal is still deployed. Run `gitforage notify --dry-run` to see the messages without sending them.

The `json` webhook posts `{ version: 1, source: "gitforage", date, title, total, portal, text, items: [{ mode, full_name, url, score, reason }] }`, where `text` is the plain-text message.

Email is not built in. The Haul has its own Atom feed (`haul/feed.xml`); point an RSS-to-email service at it for a weekly email.
