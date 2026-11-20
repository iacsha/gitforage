# Security policy

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the version or commit. You will get an acknowledgement, and a fix or a decision, as quickly as a small project can manage. Reporters are credited unless they prefer not to be.

## Supported versions

gitforage is pre-1.0. Only the latest commit on the default branch gets fixes.

## Threat model, in brief

**Untrusted repo text.** Everything gitforage shows comes from repositories anyone can create: names, descriptions, topics, release tags and user logins. A hostile repo could try to inject markdown or HTML into a digest, spoof text with bidi characters, drive a terminal with escape codes, plant a `javascript:` link, or use a crafted name to reach odd API paths or file paths. Mitigations:

- Repo names must be plain `owner/repo` (`[A-Za-z0-9_.-]`, not `.` or `..`). Others are dropped on intake, and API paths are only built from validated names.
- Control, bidi and zero-width characters are stripped, and text fields are length-capped.
- Markdown output escapes markdown and HTML control characters.
- The only links emitted are `https://github.com/<owner>/<repo>`, rebuilt from the validated name. URLs in API bodies (`html_url`, `homepage`) are never used as links.
- Cache files are named by a SHA-256 hash of the request URL, never by repo names.
- Response bodies are capped at 8 MB, items per source are capped by `limits`, and the candidate pool is capped at 5,000.
- README and description text only ever becomes lowercase `[a-z0-9+#-]` tokens for the interest profile. Only those tokens are put into search queries, quoted, and they are never rendered as markup.
- Exclusion regexes from the config run against repo text, so patterns over 200 characters, with backreferences or lookarounds, or with nested quantifiers such as `(a+)+` are refused at load time. Matched text is length-capped.

**Your config file.** `interests.yml` is data. It is parsed with the YAML core schema: no custom or language tags, no merge keys, and a low alias limit against expansion attacks. Files over 256 KB are refused. Nothing in it is executed or imported, and gitforage runs no shell commands.

**Tokens.** The GitHub token comes from `GITHUB_TOKEN` or `GH_TOKEN`. It is sent only to `api.github.com` in the `Authorization` header. It is never written to the cache, state or output, and it is redacted from error messages and logs. Use a token with no scopes (public data needs none). In the scheduled workflows, the repo's own `GITHUB_TOKEN` is enough.

**State and feedback files.** `state/seen.json`, `state/stars.json` and `feedback.yml` are validated entry by entry when read. `feedback.yml` is parsed with the safe YAML core schema with aliases off and a 1 MB cap, and every mark must have a plain `owner/repo`, `keep` or `skip`, a `YYYY-MM-DD` date and well-formed topics. Bad entries are dropped and reported, and a file with problems is never rewritten.

**The portal.** Pages are static HTML built from digest files that are validated again at build time. Every page carries a Content-Security-Policy meta tag: `default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'`. GoatCounter's script origin and endpoint are added only when analytics are configured, and its script is pinned by a subresource integrity hash. There is no inline script, inline style or style attribute. The two scripts (`theme.js`, loaded blocking in the head so the saved theme applies before paint, and `site.js`, deferred) are same-origin files. They read and write only the `gitforage-theme`, `gitforage-lang`, `gitforage-density`, `gitforage-fields` and `gitforage-sort` keys in `localStorage`, inside `try`, accept only the known values from them, and set attributes and text, never markup. Sorting and filtering compare values read from `data-*` attributes; nothing read from the page is used to build a selector or markup. A card's `data-lang` is taken from a fixed allow-list of language codes, and anything else becomes `und`. Its other `data-*` values are source names from a fixed list, topics matching `^[a-z0-9][a-z0-9-]{0,49}# Security policy

## Reporting a vulnerability

Please report privately through GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the version or commit. You will get an acknowledgement, and a fix or a decision, as quickly as a small project can manage. Reporters are credited unless they prefer not to be.

## Supported versions

gitforage is pre-1.0. Only the latest commit on the default branch gets fixes.

## Threat model, in brief

**Untrusted repo text.** Everything gitforage shows comes from repositories anyone can create: names, descriptions, topics, release tags and user logins. A hostile repo could try to inject markdown or HTML into a digest, spoof text with bidi characters, drive a terminal with escape codes, plant a `javascript:` link, or use a crafted name to reach odd API paths or file paths. Mitigations:

- Repo names must be plain `owner/repo` (`[A-Za-z0-9_.-]`, not `.` or `..`). Others are dropped on intake, and API paths are only built from validated names.
- Control, bidi and zero-width characters are stripped, and text fields are length-capped.
- Markdown output escapes markdown and HTML control characters.
- The only links emitted are `https://github.com/<owner>/<repo>`, rebuilt from the validated name. URLs in API bodies (`html_url`, `homepage`) are never used as links.
- Cache files are named by a SHA-256 hash of the request URL, never by repo names.
- Response bodies are capped at 8 MB, items per source are capped by `limits`, and the candidate pool is capped at 5,000.
- README and description text only ever becomes lowercase `[a-z0-9+#-]` tokens for the interest profile. Only those tokens are put into search queries, quoted, and they are never rendered as markup.
- Exclusion regexes from the config run against repo text, so patterns over 200 characters, with backreferences or lookarounds, or with nested quantifiers such as `(a+)+` are refused at load time. Matched text is length-capped.

**Your config file.** `interests.yml` is data. It is parsed with the YAML core schema: no custom or language tags, no merge keys, and a low alias limit against expansion attacks. Files over 256 KB are refused. Nothing in it is executed or imported, and gitforage runs no shell commands.

**Tokens.** The GitHub token comes from `GITHUB_TOKEN` or `GH_TOKEN`. It is sent only to `api.github.com` in the `Authorization` header. It is never written to the cache, state or output, and it is redacted from error messages and logs. Use a token with no scopes (public data needs none). In the scheduled workflows, the repo's own `GITHUB_TOKEN` is enough.

**State and feedback files.** `state/seen.json`, `state/stars.json` and `feedback.yml` are validated entry by entry when read. `feedback.yml` is parsed with the safe YAML core schema with aliases off and a 1 MB cap, and every mark must have a plain `owner/repo`, `keep` or `skip`, a `YYYY-MM-DD` date and well-formed topics. Bad entries are dropped and reported, and a file with problems is never rewritten.

**The portal.** Pages are static HTML built from digest files that are validated again at build time. Every page carries a Content-Security-Policy meta tag: `default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'`. GoatCounter's script origin and endpoint are added only when analytics are configured, and its script is pinned by a subresource integrity hash. There is no inline script, inline style or style attribute. The two scripts (`theme.js`, loaded blocking in the head so the saved theme applies before paint, and `site.js`, deferred) are same-origin files. , and numbers formatted by the build, so a hostile digest can only ever produce `0`. A test checks every `data-*` attribute name on every page against an allow-list. All dynamic text goes through one HTML escaper (the page templates apply it to every value), which strips control and bidi characters and escapes `&`, `<`, `>`, both quotes and the backtick. Every `href` passes a check that allows only `https://github.com/<owner>/<repo>` links rebuilt from validated names, the project link, and relative links inside the site. The Atom feed has its own XML escaper. Tests feed hostile descriptions (`<img onerror>`, `<script>`, `javascript:`, quote-breaking attributes, bidi overrides) through the whole build and check the output is inert.

**Visitor feedback.** The Keep and Skip buttons open a prefilled issue on the portal repo, with the title URL-encoded from a validated name. Issue text is untrusted input. `gitforage feedback`:

- accepts only a title of exactly `keep: owner/name` or `skip: owner/name` (`^(keep|skip): [A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$`), and reads nothing else from the issue;
- ignores bots, and visitor accounts younger than `feedback.min_account_age_days` (30 by default; an age that cannot be checked counts as too young);
- limits each visitor to `feedback.max_per_user` marks per run and per UTC day;
- lets visitors mark only repos the portal has listed (no API call is made for them), and takes topics and language from the digest, never from the issue;
- records owner and visitor marks separately: a visitor mark weighs `feedback.visitor_weight` (0.25) and cannot hide a repo;
- replies with fixed text and the validated name only, never the issue's title or body.

**The workflows.** Every action is pinned by a full commit SHA, and gitforage by a full commit SHA that the workflow verifies after checkout; dependencies install with `--frozen-lockfile` against the committed `bun.lock`. Top-level permissions are empty, and each job asks only for what it needs (forage: `contents: write`; deploy: `pages: write`, `id-token: write`; feedback: `contents: write`, `issues: write`). There is no `pull_request_target`. Checkouts use `persist-credentials: false`, so the token is not in `.git/config` while gitforage runs; it is passed to `git push` for that one command. No `${{ }}` expression appears inside a `run:` script: the issue event is read from `$GITHUB_EVENT_PATH` and open issues from a JSON file, and only fixed values (the default branch name, the token) go through `env:`. A test suite checks these rules on every workflow in the repo.
