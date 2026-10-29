# Octane connectors

Octane's connectors import content from work systems into the local gbrain
brain so it can be searched, linked and embedded with other sources.

## The connectors

| Source kind | Imports | Document |
|---|---|---|
| `slack` | Selected Slack channels: history and thread replies | [slack-mcp.md](slack-mcp.md) |
| `jira` | Jira issues selected by JQL, with descriptions and comments | [jira-mcp.md](jira-mcp.md) |
| `google-mcp` | Gmail messages selected by query, and Calendar event summaries | [google-mcp.md](google-mcp.md) |
| `confluence` | Pages in one Confluence space, optionally narrowed by a text query | [confluence-mcp.md](confluence-mcp.md) |

Each connector is a separate source kind with its own command-line options
and its own stored configuration. Jira and Confluence are separate connectors,
even though both are Atlassian products.
gbrain's built-in `google` and `github` kinds are not part of this set and
are unchanged.

## What they have in common

All three Octane connectors follow the same design:

1. **Existing MCP connection.** Authentication is handled by an MCP server
   that the operator has already configured. gbrain reads that connection
   at runtime and never stores credentials in its own configuration. See
   [mcp-connection.md](mcp-connection.md).
2. **Explicit scope.** Each source requires an explicit selection: Slack
   channel IDs or archive URLs, a Jira JQL query, or a Gmail query and
   Calendar window. Nothing is imported by default.
3. **Read only.** The connectors only call read tools. They never write to
   Slack, Jira or Google.
4. **Sequential, paced requests.** Calls run one at a time with a fixed
   minimum interval between them. Rate-limit responses stop the affected
   item and are retried on a later run rather than retried in a tight loop.
5. **Stable pages.** Each imported item becomes a Markdown page with a
   stable path inside its source, so reruns update the same page instead of
   creating duplicates.
6. **Managed checkpoints.** Progress is saved after each page, so an
   interrupted run resumes from its saved position.
7. **Honest results.** Pagination must complete, and missing or inconsistent
   metadata is an error rather than an assumed success. Partial coverage is
   reported as `partial` with a reason.
8. **Source isolation.** Pages belong to exactly one source. Each source
   records the identity it was started with, and a run that finds a different
   identity is refused rather than mixed into existing data.

## Shared implementation

| Path | Responsibility |
|---|---|
| `src/core/mcp-source.ts` | Reads the MCP connection file, checks required tools, and performs read-only calls |
| `src/core/slack/` | Slack configuration, MCP calls, and page rendering |
| `src/core/jira/` | Jira configuration, MCP calls, and page rendering |
| `src/core/google-mcp/` | Google configuration, Gmail and Calendar calls, and page rendering |
| `src/core/persistence/` | Managed source identity, checkpoints and sync results shared by all connectors |

## Operating the connectors

After a sync, the usual brain steps apply to every connector:

```bash
gbrain sync --source <id> --no-embed
gbrain extract --stale --catch-up --source-id <id> --brain host
gbrain embed --stale --catch-up --source <id>
gbrain search '<a phrase from the content>' --source <id>
```

`embed` sends the imported text to the configured embedding provider. Run it
deliberately, one source at a time, and check the reported cost first.

## Known limits across connectors

- The connectors depend on the structured output of their MCP servers. The
  current Slack and Jira servers return text that the connectors parse
  strictly; a server change that alters the format causes a clear error
  instead of silent partial imports.
- Attachments, Jira change history and Slack files are not downloaded.
- Completed selections are read again on later runs, so edits are picked up.
  Items that leave a selection are kept, not deleted.
- Full-history imports take time because of pacing. The pace is deliberate
  and may be adjusted per connector; see each connector's document.
