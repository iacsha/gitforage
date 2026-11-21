# The portal and Keep/Skip

# The portal

`gitforage site` builds a static site from the digests that `run` keeps in `state/digests/`:

- **Discover** (the home page): the latest discover-mode run, useful tools ranked by fit.
- **Get involved:** the latest contribute-mode run, with a maintainer line on each card (outside pull requests merged in 90 days, share of recent issues answered) when the run has that data.
- **Topics:** a page per topic in `interests.yml`, with everything listed for it so far. With [personalization](#pick-your-topics) on, the page is grouped like the picker (`catalog.groups`, in config order), each topic with its count of finds, and every catalog topic with finds gets a page too (digest listings first, then the latest catalog's finds). Topics with nothing found yet are listed once, quietly, at the end.
- **Archive:** every past digest.
- **About:** what the portal looks for, how scoring works (with this portal's actual weights), how Keep and Skip work, and how to run your own.
- **Found early** (`early-finds/`, with `early_finds.enabled`): the live record of finds this portal showed before they reached GitHub Trending, the Hacker News front page or a star milestone. See [Found early](#found-early).
- **`feed.xml`:** an Atom 1.0 feed with an entry per listed repo.

Each card shows the repo (linked to GitHub), its description, a source badge (**New**, **Rising**, **Live fork** or **Like your stars**), the top scoring reasons as chips, its topics (the portal's own topics first, filled, with a check mark and "matches your patch" for screen readers; with a visitor's picks, their topics instead; the rest as quiet outlines), stars, language and last push, and Keep and Skip buttons. Keys: `j` and `k` move between cards, `Enter` opens one.

The site is plain HTML and CSS with two small same-origin scripts (and, with [personalization](#pick-your-topics) on, a third on the Discover page). It uses system fonts, works on a phone, and loads nothing from other hosts unless you turn on analytics. With personalization on, a visitor's browser calls `api.github.com` only when they press "Use my GitHub stars".

Two buttons sit in the header, next to the Density control (see [Layout](#layout)):

- **Theme** cycles System, Light and Dark. System follows your device's setting. The choice is saved in your browser, and `assets/theme.js` applies it before the page paints, so there is no flash of the wrong theme.
- **Language** ("English only" by default when `filters.spoken_languages: [en]`) shows or hides cards in other languages. Each card carries its detected language. The default is the config's, and it holds without JavaScript, because the hiding is plain CSS set by the server. The choice is saved like the theme.

Both buttons stay hidden without JavaScript. If the browser blocks storage, the page still works and the choice lasts for that page.

## Layout

Visitors can change how the cards look. The portal's defaults come from `site.layout` in `interests.yml`:

```yaml
site:
  layout:
    density: compact      # comfortable (default), compact or list
    sort: score           # score (default), newest, stars or rising
    fields: { reasons: true, health: true, language: true, stars: true }
```

- **Density** sits next to Theme and Language. **Comfortable** is the full card. **Compact** uses smaller text and tighter cards, two to four columns on a wide screen (one on a phone), with descriptions cut to three lines and reasons to two rows. **List** is one dense row per repo: name, score, top reason, stars, language, and Keep and Skip. On a phone each row stacks into three short lines.
- **View** turns card fields on or off: reasons, the maintainer line (Get involved), language and stars.
- **Sort** orders by score, newest repo, stars, or **rising** (the points the star-velocity and star-growth rules gave). The keys `j` and `k` follow the order shown.
- **Filter chips** narrow the list by source (New, Rising, Live fork, Like your stars) and by topic (your topics that appear on the page). Chips in one group widen the match, and groups narrow it: "Rising" plus "hl7" plus "fhir" shows rising repos in hl7 or fhir. The bar shows "N shown of M" and announces it to screen readers.

Density, fields and sort are saved in the browser like the theme, and `theme.js` applies density and fields before the page paints. Filters last for the page. Without JavaScript the controls stay hidden and the page uses the config's density, fields and order, because the server writes them into the HTML.

**Analytics** are off by default. For cookieless visit counts with [GoatCounter](https://www.goatcounter.com), create a GoatCounter site and add `analytics: { provider: goatcounter, code: <your code> }` under `site:`. The script is loaded with a subresource integrity hash, and only GoatCounter's own origins are added to the Content-Security-Policy. With [personalization](#pick-your-topics) on, picking a starter pack or a topic is also counted as a GoatCounter event (`pick-pack-<id>`, `pick-topic-<topic>`, `pick-stars-used`): fixed names over the catalog's own slugs, never a username or anything typed.

## Pick your topics

A portal can let each visitor re-rank it for their own interests, in their browser, with no server and no account. Turn it on with `site.personalize`:

```yaml
site:
  personalize:
    enabled: true
    catalog:
      per_topic: 25            # best candidates kept per topic (1 to 100)
      groups:                  # the picker's groups, in order
        - name: Healthcare interoperability
          topics: [hl7, fhir, dicom, ehr]
        - name: Rust, Go and TypeScript
          topics: [rust, golang, typescript]
      topics: [gamedev]        # more topics, shown under "More topics"
    packs:                     # starter packs: one click picks their topics
      - { id: healthcare-dev, name: Healthcare dev, topics: [hl7, fhir, dicom] }
```

The catalog is the groups' topics, `catalog.topics` and your own `topics` (at most 150). The default view does not change: the Discover page still shows the digest for your own topics, rendered by the server, and that is all a visitor without JavaScript sees.

**What the forage does.** In discover mode, `run` also searches every catalog topic that is not one of your topics: one search for new repos and one for rising repos each, as for your own topics. Candidates found only by those searches are kept out of your digest. Every candidate is then scored again with the catalog topics, and its score without the `topic_match` term (the base score), its other reasons, star velocity, sources and detected spoken language go into `state/catalog.json`. The site writes them to `catalog.json`. Only the best `per_topic` candidates of each topic are kept (by base score), at most 2,500 in all, and the file has a 1.6 MB budget: when the catalog would be bigger, the per-topic cap is lowered until it fits. That keeps `catalog.json` well under 400 KB gzipped. Exclusions, the language filter and the star-farm guard apply to the catalog as to the digest. Activity signals (releases, README, contributing) are only fetched for the digest's top `signals_top`, so most catalog cards score without them.

**What the visitor sees.** A **Pick your topics** button above the Discover list opens a dialog with:

- **Starter packs**, which tick their topics.
- **Use my GitHub stars**: a username field. The visitor's browser reads up to three pages of `https://api.github.com/users/<name>/starred` itself, without a token. gitforage weighs each catalog topic by how much more common it is on those stars than in the catalog (lift) and ticks the strongest few. Only the topics and their weights are kept, with the date, in the browser; the username and the starred repos are not stored anywhere. A missing user, GitHub's rate limit (60 unauthenticated lookups an hour per network, shown as "try again later") and network errors each get a plain message.
- **Topics**: a searchable checklist, grouped as configured, with a live "N repos for M topics" count.
- **Clear my local marks.**
- **Carry your patch**: **Export** saves `gitforage-patch.json` (the picked topics, the pack and the local marks) to the downloads folder, and **Import** reads such a file back, so a visitor can move their patch to another computer without an account. The file never leaves the browser except as that download.
**Show** re-ranks the catalog in the browser: each repo's base score plus `topic_match` for every picked topic it carries (up to three, as on the server, with the same "2 of your topics (hl7, fhir)" reason), plus any local marks. Repos with none of the picked topics are hidden. The bar then says "N repos for your topics", with **Copy link** and **Reset to the default view**. The dialog is a modal `<dialog>`: focus stays inside it, Esc closes it, and focus goes back to the button.

**Local Keep and Skip.** Every card on the Discover page also gets **More like this** and **Hide** buttons that work in this browser only, for visitors without a GitHub account. Hide removes the repo here; both nudge repos with the same topics, owner and language, the way `feedback.yml` does on the server (`tanh(net / 2)` per key). The GitHub-issue Keep and Skip buttons stay as they are.

**Links.** `?t=hl7,fhir` and `?pack=healthcare-dev` open that view. Both are checked against the catalog's topics and pack ids, and anything else (or a value over 600 characters) is ignored. The address updates as the view changes (`history.replaceState`), so it can be bookmarked or shared.

**Saved in the browser:** `gitforage-picks` (the topics and pack), `gitforage-marks` (repo, mark, and the repo's topics and language, at most 500) and `gitforage-stars` (topic weights and a date, kept 30 days). Each is schema-checked when read and dropped when it does not fit.

**API budget.** The extra cost is two searches per extra catalog topic, all on the search limit (30 a minute, including for the Actions `GITHUB_TOKEN`), plus nothing on the core limit. The demo's 96 topics (80 beyond its own) add 160 searches. Measured on 2026-11-20 with a cold cache and the Actions-sized `GITHUB_TOKEN` limits: a full discover run took 364 API requests and about 8 minutes (123 s of that waiting for the search limit), and the contribute run after it 101 requests (166 answered from cache) and under a minute, so about 465 requests and 9 minutes for a week. That is far inside a scheduled run's limits, so the whole catalog is foraged every week and no topic rotation is needed. It scored 1,908 catalog candidates, kept 1,363 (25 per topic), and `catalog.json` came to 0.91 MB raw and 0.19 MB gzipped. Each extra topic adds two searches, about 4 seconds at the search limit.

## Found early

The Backtest page is a simulation: it replays the rules on past weeks. Found early is the live record of what this portal actually showed, and the two are kept apart (each links to the other, and nothing simulated is counted on the live page).

With `early_finds.enabled`, the daily `early-finds` workflow runs `gitforage early-finds`, which keeps `state/early-finds.json`. For every repo in `state/seen.json` it records when the portal first showed it, and then watches for three signals:

- **GitHub Trending:** the daily, all-languages Trending page, read once a day. The first day a tracked repo is on it is kept.
- **The Hacker News front page:** front-page stories of the last two days from the Algolia HN API, matched on a `github.com/<owner>/<repo>` link. The first such story (date, id, points) is kept.
- **Star milestones:** 1,000, 5,000, 10,000, 25,000 and 50,000 stars. Each repo is looked up at most once every six days, and at most 400 a day, least recently checked first. The first lookup records the stars at first check, and a milestone counts only if it is crossed after that.

The lead is the days from the day a repo was first shown to the day of the signal. Only a lead of at least one day counts. Trending and Hacker News are credited only for repos watched from the day they were shown (or the next day) and only after the first day each check succeeded for them (`trending_from`, `hn_from`), so a repo shown before tracking began, or on a day a check failed, is not credited. A milestone counts only when the stars at the first lookup are known and below it. A repo that trended before it was shown and again later can still appear; the page says so.

The page is built when the ledger has at least one repo. It shows a headline ("N finds later reached GitHub Trending, the Hacker News front page or a star milestone, a median of X days after gitforage first showed them"), a table of finds sorted by lead (repo, first shown, what it reached first and anything after, the date and the lead in days) and a short note on the method: when tracking began, what is checked and how often, and what is not counted. With no qualifying finds yet it says "Tracking since <date>, nothing has reached Trending yet". It is linked from every footer, the About page and the Backtest page. The page is rebuilt with the rest of the portal by the weekly forage run.

To move an existing ledger from the early prototype logger, `bun scripts/import-early-finds.ts <old ledger.json> state/early-finds.json` converts and validates it.

# Keep and Skip

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
