# Slack connector (`--kind slack`)

The Slack connector imports the history and thread replies of selected
channels through an existing Slack MCP server.

## Prerequisites

- A Slack MCP server configured and authenticated per
  [mcp-connection.md](mcp-connection.md).
- The server must expose these tools:
  - `slack-conversations-history`
  - `slack-conversations-replies`
- Both tools must return structured message data with exact Slack timestamps
  (`ts`), `thread_ts`, reply counts and pagination cursors. Text-only responses
  are refused. Octane's server change for this is tracked in AI-3106.

## Registering a source

```bash
gbrain sources add <id> --kind slack \
  --channels <channel-id-or-archive-url>[,<more>] \
  --mcp-config <path-to-connection-file> \
  --mcp-server slack
```

- `--channels` takes channel IDs (`C…` or `G…`) or Slack archive URLs. Names
  are not accepted, so the selection is always explicit.
- `--mcp-config` is required. `--mcp-server` defaults to `slack`.
- Duplicate channels are removed. Each channel must be a valid ID.

Then synchronize:

```bash
gbrain sync --source <id> --no-embed
```

## What is imported

Each run reads every selected channel from the start of its history.

| Page | Content |
|---|---|
| `slack-mcp/<channel>/history-NNNNNN` | One history page with messages, speakers, exact timestamps, and thread markers |
| `slack-mcp/<channel>/replies-NNNNNN` | One page per thread reply page, identifying the parent timestamp |

Each page's frontmatter records:

- `channel_id`
- `coverage` (`history` or `thread`)
- `message_count`
- `thread_replies_imported` for history pages

Thread replies are fetched for every parent that reports replies. A parent's
replies are recorded in the checkpoint once fully read, so an interrupted run
skips completed threads.

## Pacing and retries

- Calls run sequentially with a minimum interval of **1.5 seconds** between
  calls (`SLACK_MCP_INTERVAL_MS` in `src/core/slack/sync.ts`).
- A response that indicates rate limiting stops that channel for the run. The
  next run resumes from the saved checkpoint. gbrain does not try to get
  around limits.
- A channel that fails is recorded as failed, and the result is `partial`.

## Results and limits

- The sync reports `partial` when a channel fails or a reply-bearing thread
  cannot be read completely.
- Speaker identifiers are the Slack user IDs returned by the server. Display
  names are not resolved by this connector.
- Attachments are not downloaded.
- Completed channels are read again on later runs, so edits are picked up.
  Messages that disappear from history are not deleted automatically.
- Existing per-day Slack imports from earlier Slackdump-based work are kept
  and are not overwritten by this connector.
- Source identity is pinned to the MCP endpoint and server name. A run against
  a different endpoint is refused.

## Operating notes

- Embedding sends channel text to the configured model provider. Run
  `gbrain embed --stale --catch-up --source <id>` deliberately.
- Retrieval: `gbrain search '<phrase>' --source <id>` for exact text, and
  `gbrain query '<question>'` for semantic lookup once embeddings exist.
