# Development

# Dependencies

| Package | Kind | Why |
|---|---|---|
| [`yaml`](https://www.npmjs.com/package/yaml) 2.9.1 | runtime | Parses `interests.yml` with line and column errors, a safe core schema and alias limits. No dependencies of its own. |
| [`typescript`](https://www.npmjs.com/package/typescript) 7.0.2 | dev | `bun run typecheck`. |
| [`@types/bun`](https://www.npmjs.com/package/@types/bun) 1.4.5 | dev | Types for bun's APIs. |

GitHub is reached with plain `fetch`. Versions are pinned exactly, and `bun.lock` is committed.

# Development

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
demo/            interests for the public field guide at gitforage.dev
scripts/         release helpers (pin-template.ts)
```

# Releasing

The template ships with an all-zero `GITFORAGE_SHA`. On the commit being released, run `bun scripts/pin-template.ts <commit SHA>` to pin both template workflows to it.

## Why a pinned commit

The template does not install gitforage from a package registry or a moving tag. Each workflow checks out `iacsha/gitforage` at one full commit SHA, checks that it got exactly that commit, and installs its dependencies with `bun install --frozen-lockfile`, so every package is verified against the hashes in the committed `bun.lock`. A tag can be moved and a registry package can be replaced; a commit SHA cannot. To upgrade, change `GITFORAGE_SHA` on purpose. Dependabot keeps the pinned actions current, but it does not touch `GITFORAGE_SHA`.
