<p align="center"><img src="packages/site/design/logos/c-sprig.svg" width="96" height="96" alt="gitforage emblem: a berry sprig whose twig is the main line and whose berries are commits"></p>

# gitforage

*A field guide to GitHub.* See it live at **[gitforage.dev](https://gitforage.dev)** (beta).

gitforage goes out each week and forages GitHub for projects worth your time, including the young ones that trending lists overlook. You mark out your patch once in `interests.yml`, and it brings back:

- **Seedlings:** new repos sprouting in your topics and keywords.
- **Thriving:** established repos in your patch that are suddenly growing fast.
- **Wild forks and revivals:** forks that are ahead of upstream and still tended, including the living branch of a project whose upstream has gone quiet.
- **Kindred:** repos that share what is unusually common among your own stars.

Every find comes with a field note and its reasons ("3 of your topics, ~40 stars a month, top 10% in hl7"), so you can see why it made the haul. gitforage ranks by fit to you, not by popularity. It remembers what it has shown you, and your Keep and Skip marks move the ranking.

The portal is a static site with an Atom feed, a weekly issue called The Haul, a Get involved tab for contributors, a Found early record, and optional in-browser personalization. Rules first; an AI re-rank and notifications are optional. No server.

## Run your own

About five minutes, no server, no paid key. Everything runs in GitHub Actions on your own repo.

1. Open [gitforage-template](https://github.com/iacsha/gitforage-template) and choose **Use this template**, **Create a new repository** (public, so Pages is free). Or copy [`template/`](template) into a new repo by hand, including the hidden `.github` folder.
2. Edit `interests.yml`: a few topics, some seed projects, or your username in `stars_from`.
3. Settings, Pages, Source: **GitHub Actions**.
4. Actions, **forage**, Run workflow. Your portal appears at `https://<you>.github.io/<repo>/` and then updates every Sunday.

Optional extras, each switched on in `interests.yml` with its secret added under Settings, Secrets and variables, Actions:

- **AI re-rank** (`llm`): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or a local Ollama. See [AI re-rank](docs/configuration.md#ai-re-rank-optional).
- **Notifications** (`notify`): ntfy, Telegram or a webhook. See [Notifications](docs/configuration.md#notifications).
- **Found early** (`early_finds`): no secret; a daily workflow keeps the record. See [the portal](docs/portal.md).

The workflows need no secrets, and run gitforage from one pinned commit (`GITFORAGE_SHA`). Details: [docs/development.md](docs/development.md#why-a-pinned-commit).

## Run it locally

```sh
git clone https://github.com/iacsha/gitforage && cd gitforage
bun install
cp interests.example.yml interests.yml    # then edit it
export GITHUB_TOKEN=...                   # any token; no scopes needed
bun packages/cli/src/cli.ts preview
```

## Docs

| Doc | What's in it |
|---|---|
| [Configuration](docs/configuration.md) | Every `interests.yml` key and its default |
| [The portal](docs/portal.md) | Pages, layout, Pick your topics, Keep and Skip |
| [Sources and scoring](docs/sources-and-scoring.md) | Where finds come from, filters, the star-farm guard, how points add up |
| [Command line](docs/cli.md) | Commands, state and feedback files |
| [Security design](docs/security-design.md) | How untrusted input is handled; report issues via [SECURITY.md](SECURITY.md) |
| [Development](docs/development.md) | Tests, layout, dependencies, releasing |
| [Architecture](ARCHITECTURE.md) | How the pieces fit |

## Security in brief

Strict Content-Security-Policy with no inline script, one escaper for all text, links only to GitHub URLs rebuilt from validated names, every action and gitforage itself pinned by commit SHA, and Keep/Skip issues read by title only. See [docs/security-design.md](docs/security-design.md).

## License

MIT. See [LICENSE](LICENSE).
