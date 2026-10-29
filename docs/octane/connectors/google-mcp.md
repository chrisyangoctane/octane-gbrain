# Google connector (`--kind google-mcp`)

The Google MCP connector imports selected Gmail messages and Calendar event
summaries through an existing Google MCP server. It is separate from gbrain's
built-in `google` kind, which is unchanged.

## Prerequisites

- A Google MCP server configured and authenticated per
  [mcp-connection.md](mcp-connection.md).
- The server must expose the tools this connector uses:
  - `google-search-gmail-messages` and `google-read-gmail-message` for Gmail
  - `google-list-events` for Calendar
- Each source needs only the tools for the services it selects.

## Registering a source

At least one of Gmail or Calendar must be selected.

```bash
gbrain sources add <id> --kind google-mcp \
  --account <declared-mailbox-address> \
  [--gmail-query '<Gmail search query>'] \
  [--calendar-id <calendar-id> --time-min <RFC3339> --time-max <RFC3339>] \
  --mcp-config <path-to-connection-file> \
  --mcp-server google
```

- `--account` is required. It labels the mailbox for this source. See
  "Identity" below.
- `--gmail-query` selects messages using Gmail search syntax, for example
  `after:2026/01/01 before:2026/02/01`. Only messages matching the query are
  imported, not whole threads.
- `--calendar-id primary` selects the connected account's primary calendar.
  Other calendars must be named by their ID explicitly. Calendar selection
  needs both `--time-min` and `--time-max` as RFC 3339 timestamps, with
  `--time-min` earlier than `--time-max`.
- `--mcp-server` defaults to `google`.

Then synchronize:

```bash
gbrain sync --source <id> --no-embed
```

## What is imported

| Page | Content |
|---|---|
| `gmail-mcp/<message-id>.md` | Message headers returned by the server, the thread ID, and the message body |
| `calendar-mcp/<selection>/page-NNNNNN.md` | One page per Calendar result page: event summaries |

Gmail frontmatter records `message_id`, `thread_id`, `account`,
`body_truncated`, and `identity_verified: false`.

Calendar frontmatter records `calendar_id`, `time_min`, `time_max`,
`event_count`, `coverage: event-summaries`, and `identity_verified: false`.

## Coverage limits

- **Gmail bodies are capped by the server at about 10,000 characters.** A
  longer body is stored with `body_truncated: true`. Any truncated message makes
  the sync result `partial` with a clear reason. Stored pages are not claimed
  to be complete.
- **Calendar imports are event summaries only.** The current tool returns
  titles, times, locations, IDs and links. Descriptions and attendees are not
  returned and are not imported. Pages record `coverage: event-summaries`.
- Attachments are not downloaded.
- Drive and Docs are not part of this connector.
- Calendar windows are fixed when the source is registered. Re-running the
  sync reads the same window again; it does not move forward automatically.

## Identity

The Google MCP does not provide a verified mailbox-profile tool. gbrain
therefore cannot prove which Google account a connection belongs to.

- `--account` is a declared label. Pages record `identity_verified: false`.
- The source is pinned to the declared account and the connection's endpoint.
  Changing either makes later runs refuse to continue.
- gbrain never infers the mailbox from message headers.
- Use a separate connection and source for each mailbox, so one source never
  mixes accounts.

## Pacing and retries

- Calls run sequentially with a minimum interval of **1.5 seconds** between
  calls (`src/core/google-mcp/sync.ts`).
- A failed message is recorded by its ID and retried on later runs; the result
  is `partial` until it succeeds. Other messages continue.
- Gmail search follows the server's page token until it is exhausted. A
  repeated token stops the run.

## Retrieval

```bash
gbrain search '<phrase from an email>' --source <id>
gbrain query '<question>' --source <id>
```

Embedding sends message and event text to the configured model provider. Run
`gbrain embed --stale --catch-up --source <id>` deliberately.
