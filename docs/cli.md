# Running gitforage locally

# Run it on your machine

```sh
git clone https://github.com/iacsha/gitforage
cd gitforage
bun install
cp interests.example.yml interests.yml    # then edit it
export GITHUB_TOKEN=...                   # any token; no scopes needed for public data
bun packages/cli/src/cli.ts preview
```

A token is strongly recommended. Without one, GitHub allows 60 requests an hour, which is not enough for a full run. `GH_TOKEN` works too. The token is only sent to `api.github.com`, in the `Authorization` header.

# Commands

```
gitforage preview  [--config interests.yml] [--mode discover|contribute] [--limit N] [--json] [--out preview.md] [--debug]
gitforage run      [--config interests.yml] [--mode discover|contribute] [--limit N] [--json] [--out digest.md] [--state state/seen.json]
                   [--feedback feedback.yml] [--debug]
gitforage site     [--config interests.yml] --out DIR [--repo owner/name] [--state state/seen.json]
gitforage feedback [--config interests.yml] [--event FILE] [--issues FILE] [--replies DIR] [--feedback feedback.yml] [--json]
gitforage notify   [--config interests.yml] [--state state/seen.json] [--date YYYY-MM-DD] [--repo owner/name] [--dry-run]
gitforage early-finds [--config interests.yml] [--state state/seen.json]
```

- `preview` prints a ranked list: score, repo, stars, source, top reasons and link. It ignores the seen state and does not write it. With `--out` it writes markdown instead.
- `run` leaves out anything already in `state/seen.json`, prints a markdown digest (or writes it with `--out`), records what it reported in `state/seen.json`, records star counts in `state/stars.json` for rising repos, writes `state/catalog.json` in discover mode when `site.personalize` is on, and keeps the list in `state/digests/<date>-<mode>.json` for the portal.
- `site` builds the portal from `state/digests/` into `--out`. `--repo` names the portal repo for the Keep and Skip links (the workflow passes its own repo).
- `feedback` reads issues as JSON: a GitHub `issues` event (`--event`), a list as the REST API returns it (`--issues`), or the `GITFORAGE_ISSUES_JSON` variable. It appends accepted marks to `feedback.yml` and, with `--replies DIR`, writes a reply per handled issue to `DIR/<number>.md`. Issues that do not look like feedback are left alone.
- `notify` reads the digests of one day from `state/digests/` (`--date`, default today in UTC) and sends one short message to each channel under `notify.channels`: the date, the top `notify.top` finds of each mode (name, score, top reason) and a link to the portal (`site.url`, or the Pages URL of `site.repo` or `--repo`). `--dry-run` prints each channel's message and sends nothing. It exits 0 when no channel is configured or the day has no new finds, reports each channel as sent, skipped (its secret is not set) or failed, and exits 1 if any channel failed. Secrets come from the environment only; see [Notifications](configuration.md#notifications).
- `early-finds` (with `early_finds.enabled`) updates `state/early-finds.json` beside the seen state: it adds every repo in `state/seen.json` not tracked yet, checks GitHub Trending and the Hacker News front page, and looks up stars for up to 400 repos not checked in six days. With `early_finds.enabled` off, or no seen state yet, it says so and writes nothing. If Trending or HN cannot be read it warns and still checks stars. The `early-finds` workflow runs it daily. See [Found early](portal.md#found-early).
- Both read `feedback.yml` next to the config (or `--feedback FILE`) when it exists.
- `--mode` overrides `mode` from the config.
- `--json` gives every reason with its points, plus the fork, kin and signal details, the detected language (`lang`, `lang_confidence`) and any star-farm evidence.
- `--debug` lists every dropped repo and why on stderr ("dropped owner/name: written in Chinese (zh), not in filters.spoken_languages").
- `--no-cache` skips the response cache, `--cache-dir` moves it, `--quiet` silences progress and stats.

Progress and a summary go to stderr: how many candidates each source found, how many were dropped (and how many of those for language or a suspected star farm), how many API requests were made, how many came from the cache, and the time taken.

From the repo root, `bun run gitforage preview ...` is the same as `bun packages/cli/src/cli.ts preview ...`.

# State and feedback

`gitforage run` keeps `state/seen.json` next to the config (or at `--state`). It maps each reported `owner/repo` to the date it was first shown and its score then. Beside it, `state/stars.json` holds the star counts used for growth, `state/catalog.json` the personalization catalog (when on), `state/early-finds.json` the early-finds ledger (when on), and `state/digests/` holds each run's list. Keys are sorted so the files diff cleanly in git. `preview` never writes them; it reads `stars.json` so growth shows up. A second `run` on the same day and mode adds to that day's digest instead of replacing it. Running discover and then contribute with the same state, as the template does, lists each repo once, in the first mode that ranks it.

`feedback.yml` holds your Keep and Skip marks:

```yaml
version: 1
marks:
  - { repo: owner/name, mark: keep, date: 2026-11-29, topics: [hl7, fhir], language: Java }
  - { repo: other/name, mark: skip, date: 2026-11-29, topics: [spamlist], language: Kotlin }
```

Marks that come in through the portal also carry `from: visitor` or `from: owner`, and `by: <login>`. A mark without `from` is yours. Your latest mark per repo counts, and a repo you skipped is never shown again. Each visitor's latest mark per repo counts `feedback.visitor_weight` of one of yours, and a visitor's Skip only nudges. Marks add up per topic, per owner and per language into a nudge between -1 and 1 (`tanh(net / 2)`: one mark moves things a little, three most of the way), and the `feedback` rule adds `weight x (2 x topic nudge + owner nudge + language nudge)`, where the topic nudge is the mean over the repo's topics that have one. Topics and language are stored with the mark, because they are what the nudges are keyed on. You can add marks by hand too.
