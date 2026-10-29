# MCP connection

The Octane connectors read data through Model Context Protocol (MCP) servers.
Authentication with the upstream service is handled by the MCP server, not by
gbrain.

## Assumptions

- The MCP server is already set up and authenticated. Server setup and
  authentication are managed through the internal portal at
  `https://tools.ai-dev.octane.co/portal/servers`.
- The connection uses Streamable HTTP. gbrain does not start local MCP
  processes or use stdio servers for ingestion.
- gbrain does not implement its own OAuth flow for these connectors.

## Connection file

Every connector takes two options:

| Option | Meaning |
|---|---|
| `--mcp-config <path>` | A JSON or JSONC file that describes the connection |
| `--mcp-server <name>` | The server entry to use from that file (defaults are per connector) |

The file can use either layout:

```json
{"mcpServers":{"<name>":{"url":"https://<mcp-host>/<path>","headers":{"Authorization":"Bearer {env:<VARIABLE>}"}}}}
```

```json
{"mcp":{"<name>":{"type":"remote","url":"https://<mcp-host>/<path>","headers":{"Authorization":"Bearer {env:<VARIABLE>}"}}}}
```

Rules enforced by gbrain:

- The entry must be remote: it must have a `url` and must not have a `command`.
- `enabled: false` is refused.
- The URL must be `https`, or `http` for `localhost`, `127.0.0.1` or `[::1]`.
  URLs with credentials, query strings or fragments are refused.
- Header values may reference environment variables with `{env:NAME}`. The
  variable is read at runtime. If it is missing, gbrain fails before any call.

The connection file path and server name are stored in the source
configuration. Header values, tokens and environment values are not stored.

## What gbrain checks at connect time

1. The connection file parses and names an allowed remote server.
2. The MCP client connects and lists all tools, following tool-list pages.
3. Every tool required by the connector is present. If any is missing, the
   sync stops with an error naming the connection, without making any data
   calls.

A connector may only call the tools in its own allowlist. Calls to any other
tool are refused in code.

## Failure behavior

- Connection and tool-discovery failures stop the run with a message that
  points at the MCP connection, not at credentials.
- Errors returned by the MCP are summarized without echoing the response body,
  because bodies can contain private content or secrets.
- No automatic retry loop is used for connection failures. The next run
  attempts the connection again.

## What is not supported

- Discovering or creating MCP servers.
- Storing or refreshing OAuth tokens for MCP servers.
- Reading another client's private token store.
