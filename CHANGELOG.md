# Changelog

gitforage is pre-1.0. Each release names the commit the template workflows pin.

## 0.1.0 (2026-11-21)

The first public release: everything a portal needs, with no server and no paid key.

**Foraging and scoring**
- Four sources: new repos in your topics and keywords, rising older repos, live forks of projects you follow, and kin of your own stars.
- The Revival radar: dormant upstreams in your topics and the live fork carrying each one.
- Rule scores with readable reasons, popularity measured within each topic, spoken-language detection, a star-farm guard, exclusions, and Keep/Skip feedback that nudges the ranking.
- Two modes: discover (useful tools) and contribute (projects to get involved in).

**Optional AI re-rank** (`llm`)
- Anthropic, any OpenAI-compatible endpoint, or local Ollama judge the top results against your profile.
- The model can move a score by at most `llm.weight` points either way, and can add a labelled *AI field note* to the card.
- Keys come from the environment only. Repo text and model output are both treated as untrusted, and any failure keeps the rule ranking.

**Notifications** (`notify`)
- After the weekly run, one short message goes to ntfy, Telegram or a webhook (JSON, Slack or Discord), with each channel's escaping.
- Secrets come from repository secrets, and a failed ping never blocks the deploy.

**The portal**
- A static site on GitHub Pages with:
  - Discover and Get involved tabs, plus topic pages, an archive and an Atom feed.
  - The Haul, a numbered weekly issue with its own feed.
  - Density, sort and filter controls.
  - Optional in-browser personalization (pick your topics, use your GitHub stars, local Keep/Skip, shareable links).
- **Found early:** the live record of finds this portal showed before they reached GitHub Trending, the Hacker News front page or a star milestone. It is kept by a daily workflow. The separate **Backtest (simulated)** page replays the same rules on past weeks.
- A strict Content-Security-Policy, no inline script, one escaper for all text, and links only to GitHub URLs rebuilt from validated names.

**Running it**
- Template workflows for forage (weekly), feedback (Keep/Skip issues) and early finds (daily). They have least-privilege permissions, every action is pinned by SHA, and gitforage itself is pinned by commit.
