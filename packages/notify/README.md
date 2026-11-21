# packages/notify

`@gitforage/notify`: the notifiers behind `gitforage notify`. After a run it sends one short message (the date, the top finds of each mode with score and top reason, and a link to the portal) to:

- **ntfy** (`ntfy.sh` or your own https server): a plain-text body with Markdown off.
- **Telegram** (Bot API `sendMessage`, always `https://api.telegram.org`): `parse_mode` HTML with every text escaped, link previews off.
- **a webhook**, as `json` (a structured payload), `slack` (incoming webhook `text`) or `discord` (webhook `content`, with mentions disabled).

Email is out of scope: point an RSS-to-email service at The Haul's Atom feed (`haul/feed.xml`).

Configuration is the `notify:` block in `interests.yml`; secrets come from environment variables only. See [Notifications](../../docs/configuration.md#notifications).

```
src/message.ts   the summary of one day's digests, and its rendering per channel
src/text.ts      defanging, per-channel escapers, fitting a message under a size limit
src/send.ts      the senders: env, timeouts, no redirects, redaction
```

No dependencies beyond `@gitforage/core`; requests use plain `fetch`, and tests inject a fake one.
