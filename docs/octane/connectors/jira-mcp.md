# Jira connector (`--kind jira`)

The Jira connector imports issues selected by a JQL query, with their
descriptions and every comment, through an existing Jira MCP server. It is
separate from any Confluence connector.

## Prerequisites

- A Jira MCP server configured and authenticated per
  [mcp-connection.md](mcp-connection.md).
- The server must expose these tools:
  - `jira-search`
  - `jira-read-issue`
  - `jira-read-comments`
- The current server returns text. The connector accepts only the expected
  text format and refuses anything it cannot validate.

## Registering a source

```bash
gbrain sources add <id> --kind jira \
  --jql '<JQL query>' \
  [--project <KEY>] \
  --mcp-config <path-to-connection-file> \
  --mcp-server jira
```

- `--jql` is required and is the real selection. Example:
  `project = SA ORDER BY key ASC` selects one project.
- `--project` optionally adds a project boundary; it must be a project key.
- Epics and saved filters are selected by JQL too, for example
  `parent = <KEY-123>` or `filter = <id>`.
- `--mcp-server` defaults to `jira`.

Then synchronize:

```bash
gbrain sync --source <id> --no-embed
```

## What is imported

| Page | Content |
|---|---|
| `jira/<issue-key>.md` | Issue summary, status, description, the source URL, and all comments |

Frontmatter records:

- `issue_key`
- `url`, built from the Jira site identity returned by the server
- `comments_complete: true`, written only after every comment page has been read

A page is written only after the issue and all of its comment pages have been
read successfully. A failed issue keeps its previous page, if any.

## How a sync proceeds

1. The connector searches with the JQL, following the server's opaque
   continuation token until no further page is returned.
2. For each issue key, it reads the issue, then reads comments page by page
   using the server's page numbers.
3. Each issue is written to its page. Failures are recorded by key.
4. Failed keys are retried first on the next run. The result is `partial`
   while any key remains failed.

Checkpoints save the search token, the position in the current page of
results, the list of failed keys and the Jira site identity after each step.

## Pacing and failures

- Calls run sequentially with a minimum interval of **1 second** between calls
  (`JIRA_MCP_INTERVAL_MS` in `src/core/jira/sync.ts`).
- A single failed issue is logged by key and the sync moves on to the next
  issue. The failed issue is retried on later runs. Its content is never
  replaced with partial data.
- The connector does not print issue bodies or server error text in logs,
  since either can contain private material.

## Safety checks

- The Jira site returned by the server must stay the same for the whole run.
  If it changes, the run stops and no further pages are imported.
- Issue responses must name the requested key and the expected URL.
- Comment responses must name the same issue and site, and must report a
  total count. An unknown total is treated as an error, because complete
  coverage cannot be verified.
- Search pages with a continuation token must contain at least one issue.
  A repeated token stops the run.

## Results and limits

- Attachments, Jira change history, worklogs and linked-issue details beyond
  what the server returns are not imported.
- Issues that leave the JQL selection are kept, not deleted.
- The source is pinned to its Jira site. A different site is refused.
- Large projects take time: at 1 second per call, each issue needs at least
  two calls, plus one per additional comment page.

## Operating notes

- Embedding sends issue text to the configured model provider. Run
  `gbrain embed --stale --catch-up --source <id>` once the sync is complete.
- Check progress with `gbrain sync status --source <id>`. A `partial` result
  names the cause; a failed item should be retried by running the sync again.
