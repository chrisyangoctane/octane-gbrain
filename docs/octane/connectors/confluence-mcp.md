# Confluence connector (`--kind confluence`)

The Confluence connector imports the pages of one Confluence space, read through
an existing Confluence MCP server. It is separate from the Jira connector, and it
does not write to Confluence.

## Prerequisites

- A Confluence MCP server configured and authenticated per
  [mcp-connection.md](mcp-connection.md).
- The server must expose these read tools:
  - `confluence-search`
  - `confluence-read-page`
- The connector calls no other tools. Write tools are never permitted.

## Registering a source

```bash
gbrain sources add <id> --kind confluence \
  --space <SPACE-KEY> \
  [--query '<text to narrow the space>'] \
  --mcp-config <path-to-connection-file> \
  --mcp-server confluence
```

- `--space` is required. It is a Confluence space key such as `DOC`. The first
  version supports space scope only; a whole-site import is not possible.
- `--query` optionally narrows the space with a text search. Omit it to import
  every page in the space.
- `--mcp-server` defaults to `confluence`.

Then synchronize:

```bash
gbrain sync --source <id> --no-embed
```

## What is imported

| Page | Content |
|---|---|
| `confluence/<page-id>.md` | The page title, version, last-updated time, and body as Markdown |

Frontmatter records `page_id`, `version`, `updated` when the server returns it,
`space`, and `identity_verified: false`.

Pages are read one at a time. A page that fails is retried on later runs, and
the result is `partial` until every page succeeds.

## How a sync proceeds

1. The connector searches the space with the server's search tool, passing the
   space key and the optional query. Results are paged with the server's opaque
   `Next Cursor` until `Has More` is `No`.
2. Each result carries the page's URL. The connector reads each page by that URL.
3. Each page is written to its stable path. Pages already imported on an earlier
   run are rewritten only when their content changes.
4. Failed pages are retried first on the next run.

Checkpoints save the search cursor and the failed-page list after each page, so
an interrupted run resumes from its saved position.

## Pacing and failures

- Calls run sequentially with a minimum interval of **1 second** between calls
  (`CONFLUENCE_MCP_INTERVAL_MS` in `src/core/confluence/sync.ts`).
- A failed page is recorded by its ID. Its content is never replaced with partial
  data. The sync continues with the remaining pages.
- The connector does not print page bodies or server error text in logs.
- A search that returns the cursor it was just given stops the run instead of
  looping.

## Safety checks

- Search output must report counts, page IDs and URLs that match. A mismatch is
  an error.
- A search that reports more results must include a cursor.
- Page IDs must be unique within a search response.
- The source is pinned to its MCP endpoint and space. A run that finds a changed
  space or endpoint is refused rather than mixing pages across spaces.

## Results and limits

- Attachments, comments, page history and labels are not imported.
- The first version does not support a root-page selection. The tree tool returns
  page IDs without the URLs the read tool requires, so a tree-based import needs a
  server change first.
- Pages that leave the space are kept, not deleted.
- A completed sweep is read again on later runs, so edits are picked up.
- The connector records `identity_verified: false`. The MCP does not prove which
  Confluence site or account the content belongs to, so the declared space and
  endpoint are the only identity checks.

## Operating notes

- Embedding sends page text to the configured model provider. Run
  `gbrain embed --stale --catch-up --source <id>` once the sync is complete.
- Check progress with `gbrain sync status --source <id>`. A `partial` result names
  the cause; running the sync again retries the failed pages.
