# Set up gbrain with GitHub sync and embeddings

This guide takes you from nothing to a local brain that holds the issues and
pull requests of the GitHub repositories you choose, with semantic search
through a LiteLLM proxy. Follow the parts in order:

1. [Install the gbrain CLI](#part-1-install-the-gbrain-cli) and create a local brain.
2. [Sync GitHub](#part-2-sync-github) through the GitHub CLI (`gh`).
3. [Turn on embeddings](#part-3-turn-on-embeddings-through-litellm) through a LiteLLM proxy.
4. [Run the MCP server and connect AI tools](#part-4-run-the-mcp-server-and-connect-ai-tools) (Codex, Claude Code, Cursor, Windsurf, GitHub Copilot, OpenCode), and [open the admin portal](#47-open-the-admin-portal).

The brain is an embedded PGLite database under `~/.gbrain`. It needs no
server, and parts 1 and 2 need no API keys.

---

## Part 1: Install the gbrain CLI

### 1.1 Install Bun

gbrain runs on [Bun](https://bun.sh) and needs **Bun 1.4.4 or newer**. Every
gbrain command refuses to run on an older Bun.

With Homebrew:

```bash
brew install bun        # or, if Bun is already installed: brew upgrade bun
bun --version           # must print 1.4.4 or newer
```

Without Homebrew:

```bash
curl -fsSL https://bun.sh/install | bash
```

If `bun --version` is still below 1.4.4 after `brew upgrade bun`, run
`bun upgrade`.

### 1.2 Install gbrain

Pick one.

**Released CLI** (recommended for most users):

```bash
bun install -g github:garrytan/gbrain
```

**From a local checkout of this repository** (use this when you work on
gbrain itself or want to run a branch):

```bash
cd <path-to-your-gbrain-checkout>
bun install
bun link                # points `gbrain` at src/cli.ts in this checkout
```

With a checkout install, switching branches or editing code changes the
`gbrain` you run immediately.

Bun may print `Blocked 1 postinstall` during a global install. That is
expected for a new install; `gbrain init` in step 1.4 does the work the
postinstall would have done.

### 1.3 Put gbrain on your PATH

Bun installs global commands into `~/.bun/bin`. Add it to your shell profile
once:

```bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
gbrain --version
```

`zsh: command not found: gbrain` means `~/.bun/bin` is not on the PATH of the
shell you are in. Open a new terminal or run `source ~/.zshrc`.

### 1.4 Create the brain

```bash
gbrain init --pglite --no-embedding
```

- `--pglite` stores the brain in an embedded database at
  `~/.gbrain/brain.pglite`.
- `--no-embedding` starts keyless: keyword search works right away. Part 3
  turns on semantic search.

`init` prints a table of search modes against downstream models and their
relative cost. The cheapest and most expensive combinations differ by roughly
200x, so read the table and choose deliberately instead of accepting the
default without looking. You can change the mode later; `init` prints the
command.

### 1.5 Verify

```bash
gbrain doctor
```

`doctor` checks the database, the schema version and the brain's
configuration, and prints the command to fix anything it finds.

If `doctor` reports `schema_version: 0`, apply the migrations:

```bash
gbrain apply-migrations --yes --no-autopilot-install
```

---

## Part 2: Sync GitHub

gbrain connects to GitHub through the GitHub CLI (`gh`): it uses the access
token of your existing `gh` login, passed to each command. Nothing extra is
created on GitHub.

### What gets synced

One page per issue or pull request, under `gh/<owner>/<repo>/<number>.md`:

- title, state (open, closed, merged, draft), labels, assignees, milestone;
- the description;
- every comment, review and inline review comment, with file and line;
- CI status for open pull requests;
- `#<n>` mentions and `Closes`/`Fixes` references as links between pages.

The sync only reads from GitHub. It never writes to a repository, issue or
pull request. Repository code is not part of this sync.

### 2.1 Install the GitHub CLI

```bash
brew install gh
gh --version
```

Without Homebrew, download an installer from <https://cli.github.com>.

### 2.2 Log in

```bash
gh auth login
```

Answer the prompts:

| Prompt | Answer |
|---|---|
| Where do you use GitHub? | `GitHub.com` |
| Preferred protocol for Git operations | `HTTPS` |
| Authenticate Git with your GitHub credentials? | `Yes` |
| How would you like to authenticate? | `Login with a web browser` |

Copy the one-time code it shows, press Enter, and approve the login in the
browser. If your organization uses single sign-on, the browser asks you to
authorize the organization as well; approve it, or the organization's private
repositories stay invisible to the sync.

### 2.3 Check the login

```bash
gh auth status
```

You should see `Logged in to github.com account <you>` and token scopes that
include `repo` and `read:org`. If `read:org` is missing, add it:

```bash
gh auth refresh -s read:org
```

Confirm you can read a repository you want to sync:

```bash
gh api repos/<owner>/<repo> --jq .full_name
```

It prints `<owner>/<repo>`. A `404` means your account cannot see that
repository; ask for access before going further.

### 2.4 Register the GitHub source

Register the source once, naming the repositories to sync:

```bash
OGH_TOKEN="$(gh auth token)" gbrain sources add gh \
  --kind github \
  --scope repos \
  --repos OctaneLending/<repo-one>,OctaneLending/<repo-two>
```

- `gh` is the source id; pages and commands refer to it.
- `--scope repos --repos ...` limits the sync to the repositories you list.
  `--scope auto` instead syncs every repository your account owns,
  collaborates on or can see as an organization member, which can be a very
  large number on an organization account.
- `GH_TOKEN="$(gh auth token)"` hands the current `gh` login token to this one
  command only.

### 2.5 Run the first sync

```bash
GH_TOKEN="$(gh auth token)" gbrain sync --source gh
```

The first sync imports the full history of every listed repository, so it can
take a while on a large repository. It is safe to interrupt: every item is
written on its own, and the next run continues where this one stopped.

A successful first sync ends with `First sync complete` and the number of
pages and chunks imported. Two notices are normal:

- `content-sanity warn: ... exceeds warn threshold` names a very long issue
  or pull request. It is stored and searchable; nothing to do.
- `page(s) have un-extracted edges` means the pages are searchable but the
  links between them (`#<n>` mentions, `Closes`/`Fixes` references) are not
  built yet. Build them now with the one-run command the sync prints:

  ```bash
  gbrain extract --stale --catch-up --source-id gh --brain host
  ```

  This is a one-time step after the first sync; later syncs touch few pages
  and routine maintenance picks them up.

Check the result:

```bash
gbrain search "<words from a pull request title>"
gbrain sources status gh
```

`sources status` shows the page count, the last sync time and a `FAILS`
column, which should be `0`.

### 2.6 Keep it up to date

Each later run imports only what changed since the last one. Always set the
token inline on the command, as above. Do not add `GH_TOKEN` or a sync
command to your shell profile (`~/.zshrc`) or to `~/.gbrain/.env`: that
leaves a plain-text copy of a broadly scoped token on disk, the copy does not
follow a later `gh auth login` or `gh auth switch`, and an exported
`GH_TOKEN` overrides `gh`'s own login in every other tool.

**By hand.** Run the sync from your terminal whenever you want the latest
pull requests:

```bash
GH_TOKEN="$(gh auth token)" gbrain sync --source gh
```

Add `--full` for a full reconcile, which also removes pages for items deleted
on GitHub:

```bash
GH_TOKEN="$(gh auth token)" gbrain sync --source gh --full
```

**On a schedule.** Create a script, for example `~/bin/gbrain-gh-sync.sh`:

```bash
#!/bin/zsh
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
GH_TOKEN="$(gh auth token)" gbrain sync --source gh >> "$HOME/.gbrain/gh-sync.log" 2>&1
```

Make it executable and add it to cron:

```bash
chmod +x ~/bin/gbrain-gh-sync.sh
crontab -e
```

```cron
*/30 * * * * $HOME/bin/gbrain-gh-sync.sh
```

The script sets `PATH` because cron does not load your shell profile. `gh`
reads its login from the macOS keychain, which is available to cron jobs that
run as your user while you are logged in. Check `~/.gbrain/gh-sync.log` for
errors. See [calling gbrain unattended](../guides/cron-schedule.md#call-gbrain-through-one-wrapper)
for the full rules on scheduled gbrain jobs.

### 2.7 Add or remove repositories

The repository list is part of the source's configuration. To change it,
archive the source and register it again with the new list:

```bash
gbrain sources archive gh
GH_TOKEN="$(gh auth token)" gbrain sources add gh-v2 \
  --kind github --scope repos --repos <owner>/<repo-one>,<owner>/<repo-three>
GH_TOKEN="$(gh auth token)" gbrain sync --source gh-v2
```

---

## Part 3: Turn on embeddings through LiteLLM

Embeddings turn on semantic search: `gbrain query` can then match the
meaning of a question, not only its keywords. This part sends embedding
requests through a [LiteLLM](https://docs.litellm.ai) proxy, such as an AI
gateway your organization runs, so page text goes only to that proxy.

### What you need

| Item | Example |
|---|---|
| The proxy's base URL | `https://llm.ai-dev.octane.co/v1` |
| A key for the proxy | `{Your Octane API key}` |
| An embedding model the proxy serves | `text-embedding-3-large` |
| That model's vector size (dimensions) | `1024` |

Ask the proxy's owner for the model name. The name is what the proxy calls
the model (its `model_name`), not necessarily the upstream provider's name.

### 3.1 Set the proxy variables

gbrain reads two environment variables for LiteLLM. The names are fixed; the
values are yours:

| Variable | Meaning |
|---|---|
| `LITELLM_BASE_URL` | The proxy's base URL. Include `/v1` when the proxy serves the OpenAI route there. Without this variable gbrain uses `http://localhost:4000`. |
| `LITELLM_API_KEY` | The proxy key. Optional only for a local proxy that runs without auth. |

Put them in gbrain's own env file, `~/.gbrain/.env`, so every gbrain command
finds them without exporting anything in your shell profile:

```bash
cat >> ~/.gbrain/.env <<'EOF'
LITELLM_BASE_URL=https://llm.ai-dev.octane.co/v1
LITELLM_API_KEY=<your-Octane-API-key>
EOF
chmod 600 ~/.gbrain/.env
```

gbrain loads this file on every command. A variable already exported in your
shell takes precedence over the file. Keep the key out of
`~/.gbrain/config.json` and out of any git repository.

Check the proxy accepts the key and the model before going further:

```bash
source ~/.gbrain/.env
curl -s "$LITELLM_BASE_URL/embeddings" \
  -H "Authorization: Bearer $LITELLM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"text-embedding-3-large","input":"test"}' | head -c 200; echo
```

A JSON response with a `data` field means it works. A `401` means the key is
wrong; a `404` usually means `/v1` should be added or removed from
`LITELLM_BASE_URL`; an error naming the model means the proxy does not serve
that model name.

### 3.2 Turn on embeddings

Stop any running gbrain sync first: this step needs exclusive access to the
brain.

```bash
gbrain init --force \
  --embedding-model litellm:text-embedding-3-large \
  --embedding-dimensions 1024 \
  --path ~/.gbrain/brain.pglite
```

- `litellm:` tells gbrain to send embedding requests to the proxy; the part
  after it is the model name the proxy serves.
- `--embedding-dimensions` is required for LiteLLM: gbrain cannot look the
  size up for a proxied model. Use the value from the table above.
- `--force` keeps every page, link and keyword index from part 2. It only
  turns on the vector column and queues existing chunks for embedding.

`init` does not call the proxy, so it succeeds even when the key is wrong.
Its output shows `Embedding: litellm:text-embedding-3-large (1024d)`. The
rest of the output is the normal first-run summary.

### 3.3 Embed the existing pages

```bash
gbrain embed --stale --catch-up --dry-run    # preview: chunk count and estimated cost, no calls
gbrain embed --stale --catch-up              # embed everything that has no vector yet
```

`--catch-up` keeps going until the backlog is empty; without it a run stops
after 30 minutes and the next run continues. Add `--source <id>` to embed one
source only, for example `--source gh`.

The proxy bills per token, so gbrain asks you to confirm the spend in an
interactive terminal. In a script or cron job there is no prompt: pass
`--max-usd <amount>` to set a ceiling, or the run stops and prints what it
needs.

### 3.4 Verify

```bash
gbrain doctor --only embeddings
gbrain query "<a question about something in your brain>"
```

`doctor` reports how many chunks are embedded and how many still wait.
`query` runs hybrid keyword and semantic search, so ask a natural-language
question rather than an exact phrase.

### Keeping embeddings working

- New pages from later GitHub syncs are embedded during the sync, as long as
  the proxy variables are available. With `~/.gbrain/.env` in place they are,
  including in cron jobs that run as your user.
- Pick the model once. Switching to a model with different dimensions means
  running step 3.2 again with the new values and re-embedding every page.
- gbrain also uses an LLM for chat, fact extraction and optional query
  expansion. Those are separate from embeddings: `init` prints the model it
  picked for them, and an `OPENAI_API_KEY` in your environment makes it pick
  OpenAI directly, not the proxy. If page text must only go to the proxy,
  run gbrain without `OPENAI_API_KEY` set (for example
  `env -u OPENAI_API_KEY gbrain sync --source gh`).

---

## Part 4: Run the MCP server and connect AI tools

The MCP server lets AI tools search and write your brain. Run one long-lived
HTTP server and point every tool at it. Do not let each tool start its own
`gbrain serve`: the local database (PGLite) allows only one process at a time,
and a second process fails with `pglite_busy`.

### 4.1 Make the env file private

`~/.gbrain/.env` holds your proxy key. Restrict it to your user:

```bash
chmod 600 ~/.gbrain/.env
```

### 4.2 Create a token for each tool

Tokens are created on the brain host. Use one token per tool so you can
revoke one without affecting the others:

```bash
set -a; source ~/.gbrain/.env; set +a
export PATH="$HOME/.bun/bin:$PATH"
gbrain auth create opencode --scopes read,write --takes-holders world
```

The command prints the token once. Save it as a line in `~/.gbrain/.env`:

```bash
GBRAIN_REMOTE_TOKEN=gbrain_xxx    # replace with the printed token
```

Use the name of the tool (`codex`, `claude-code`, `cursor`, and so on) in
place of `opencode` for each additional token, and give each tool its own
variable if you want to revoke them separately, for example
`GBRAIN_CODEX_TOKEN`. Tokens are full-access secrets for `read,write`. Never
commit them or paste them into a shared file.

### 4.3 Start the server

Start it with the env file loaded, so the server gets the LiteLLM variables
and `GBRAIN_CHAT_MODEL` / `GBRAIN_EXPANSION_MODEL`:

```bash
set -a; source ~/.gbrain/.env; set +a
export PATH="$HOME/.bun/bin:$PATH"
gbrain serve --http --port 3131 --bind 127.0.0.1
```

| Flag | Meaning |
|---|---|
| `--port 3131` | HTTP port (the default is 3131). |
| `--bind 127.0.0.1` | Listen on this Mac only. Use `0.0.0.0` only for deliberate remote access. |
| `--public-url <url>` | Needed only if clients reach the server through another address, such as a Tailscale name. |

The MCP endpoint is `http://127.0.0.1:3131/mcp`. Keep the process running
while you use the tools. `gbrain serve` does not read `.env` itself, so the
`source` line is required.

Run the CLI commands (`gbrain sync`, `gbrain think`, and so on) only while
the server is stopped, or use the MCP tools instead. The CLI cannot open the
database while the server holds it.

### 4.4 Check the server

`GET /mcp` returns `405`. That is expected: the endpoint accepts only `POST`.
Check it with an MCP `initialize` request:

```bash
set -a; source ~/.gbrain/.env; set +a
curl -s -m 15 -X POST http://127.0.0.1:3131/mcp \
  -H "Authorization: Bearer $GBRAIN_REMOTE_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'
```

A working server returns an `event: message` block with `serverInfo`. Without
the token, the same request returns `401`.

### 4.5 Connect each tool

Every tool connects to the same URL with the same bearer token. Before you
change a tool's config, remove any stdio entry that starts `gbrain serve`,
because it would start a second process.

The commands below use `$GBRAIN_REMOTE_TOKEN`. Export it in the shell that
starts the tool, or let the tool read it from the environment as noted.

| Tool | Status | How to connect |
|---|---|---|
| Codex | Documented (`docs/mcp/CODEX.md`) | `codex mcp add gbrain --url http://127.0.0.1:3131/mcp --bearer-token-env-var GBRAIN_REMOTE_TOKEN` |
| Claude Code | Documented (`docs/mcp/CLAUDE_CODE.md`) | `gbrain connect http://127.0.0.1:3131/mcp --agent claude-code --token "$GBRAIN_REMOTE_TOKEN" --install --yes`, or `claude mcp add gbrain -t http http://127.0.0.1:3131/mcp -H "Authorization: Bearer $GBRAIN_REMOTE_TOKEN"` |
| OpenCode | Documented (`docs/mcp/OPENCODE.md`) | `gbrain connect http://127.0.0.1:3131/mcp --agent opencode --install --yes`. It writes `{env:GBRAIN_REMOTE_TOKEN}`, so the token stays out of the file. |
| Cursor | Not documented in this repo | Add the entry shown below to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in one project). |
| Windsurf | Not documented in this repo | Add the entry shown below to `~/.codeium/windsurf/mcp_config.json`. |
| GitHub Copilot (VS Code) | Not documented in this repo | Add the entry shown below to `.vscode/mcp.json`, or to your user `mcp.json`. |

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "gbrain": {
      "url": "http://127.0.0.1:3131/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

**Windsurf** (`~/.codeium/windsurf/mcp_config.json`):

```json
{
  "mcpServers": {
    "gbrain": {
      "serverUrl": "http://127.0.0.1:3131/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

**GitHub Copilot in VS Code** (`.vscode/mcp.json` or user `mcp.json`):

```json
{
  "servers": {
    "gbrain": {
      "type": "http",
      "url": "http://127.0.0.1:3131/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

Cursor, Windsurf and Copilot take a literal token in these files. Do not
commit them. Keep the files private, or move the config to a machine-local
file that is not tracked by git. The shapes come from each tool's public MCP
configuration format, not from gbrain's docs; check the tool's MCP server
list after you change the file. If a shape is rejected, run
`gbrain connect http://127.0.0.1:3131/mcp --agent generic` to print the block
gbrain generates for a generic client.

### 4.6 Verify in each tool

1. Restart the tool, or start a new session. Most tools read MCP config only
   at launch.
2. Check the MCP status. The tool should show `gbrain` as connected, with its
   tools listed.
3. Ask one question the brain can answer, for example "what is v2.0?", and
   check that the answer cites pages.

If a tool shows `gbrain` as failed, check in this order: the server is
running (`curl` in 4.4), the token is exported to the tool's launch
environment, and no old stdio `gbrain serve` entry remains.

### 4.7 Open the admin portal

The server also serves an owner dashboard at `/admin`. It lists OAuth clients,
API keys, request logs, and jobs. The MCP tokens from 4.2 do not open it.

**Sign in with `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` from `~/.gbrain/.env`.** This
is the owner credential for the portal and for `gbrain mcp admin`.

Where the value comes from:

- **Generated at startup:** if `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` is not set, the
  server generates a token for that process and prints it to the console
  when it starts in an interactive terminal. It changes on every restart.
- **Set in `.env`:** if you set the variable, the server uses that value and
  does not print it. The value must be at least 32 characters from `A–Z`,
  `a–z`, `0–9`, `_` and `-`. Generate one with `openssl rand -hex 32`:

  ```bash
  GBRAIN_ADMIN_BOOTSTRAP_TOKEN=<output of: openssl rand -hex 32>
  ```

  A fixed value survives restarts, so use this for a server you keep running.

Then sign in:

1. Start the server (4.3) with `.env` loaded.
2. Open `http://127.0.0.1:3131/admin/` in a browser.
3. Paste the value of `GBRAIN_ADMIN_BOOTSTRAP_TOKEN` into the login field
   and submit.

A successful login sets a `gbrain_admin` cookie that lasts 24 hours. A
server restart clears it, so you will need to log in again.

If the console printed a generated token and you did not set `.env`, that
token is the value to paste. Restarting the server replaces it.

**Limits to know:**

- The owner credential is not an MCP token, and an MCP token cannot log in
  here.
- `gbrain mcp admin login-link` also needs the owner credential, passed with
  `--admin-token-file` or `GBRAIN_ADMIN_BOOTSTRAP_TOKEN`. An MCP token fails
  with `admin_credentials_required`. Use the login link only for handing
  access to someone else, and do not open it yourself, because it is
  single-use and expires after five minutes.
- Keep the credential private. Do not commit it, paste it into a tool's MCP
  config, or leave it in shell history.

---

## Updating gbrain

| Install type | Update command |
|---|---|
| Released CLI | `gbrain upgrade` |
| Local checkout | `git pull` in the checkout, then `bun install` |

## Troubleshooting

### Install and brain

| Symptom | Fix |
|---|---|
| `command not found: gbrain` | Add `~/.bun/bin` to your PATH (step 1.3). |
| gbrain refuses to run and names a Bun version | Upgrade Bun to 1.4.4 or newer (step 1.1). |
| `schema_version: 0` in `gbrain doctor` | `gbrain apply-migrations --yes --no-autopilot-install` |
| `pglite_busy: ... already open through gbrain serve` | An agent app that runs gbrain as an MCP server (`gbrain serve`) holds the local database while it is open. Close that app, or stop the PID the error names, then run the command again. |
| `connect timed out` | Another gbrain process (a running sync or `serve`) holds the local database. Let it finish, then retry, or pass `--timeout=60s` for a longer wait. |

### GitHub sync

| Symptom | Cause and fix |
|---|---|
| `GitHub API HTTP 404 on /repos/<owner>/<repo>/...` | Your `gh` account cannot see the repository. Run `gh api repos/<owner>/<repo>`; if it also returns 404, request access, or authorize single sign-on for the organization (`gh auth refresh`, then approve in the browser). |
| `401`, `Bad credentials` or `has no token` | `GH_TOKEN` was not set for the command, or the `gh` login expired. Run `gh auth status`, log in again if needed, and pass `GH_TOKEN="$(gh auth token)"` inline. |
| `connector_account_changed` | The source is tied to the GitHub account that first synced it, and `gh` is now logged in as a different account. Switch back with `gh auth switch`, or register a new source for the new account. |
| `Sync PARTIAL [connector_item_failures]` | Some items failed. The reasons print above the summary. Fix the cause and run the sync again; the cursor does not move past failed items. |
| Items listed as held in `gbrain sources status gh` | An item failed on three syncs in a row and was set aside. Fix the cause, then `gbrain sources retry-held gh` and sync again. |
| No issue pages for a repository | That repository has issues turned off on GitHub. Pull requests still sync. |

### Embeddings

| Symptom | Cause and fix |
|---|---|
| `doctor` still says embeddings are disabled | Step 3.2 did not run or failed. Run it again and look for `Embedding: litellm:...` in the output. |
| `401` or `authentication` errors from `gbrain embed` | `LITELLM_API_KEY` is missing or wrong. Check `~/.gbrain/.env`, and check no older value is exported in your shell (`echo $LITELLM_API_KEY`), because an exported value wins over the file. |
| `404` or connection refused | `LITELLM_BASE_URL` is wrong, or unset so gbrain tries `http://localhost:4000`. Try the URL with and without `/v1` using the curl check in step 3.1. |
| Dimension mismatch error | `--embedding-dimensions` does not match what the model returns. Use the model's real size and run step 3.2 again. |
| `gbrain embed` exits with code 3 | It needs spend approval. Run it in a terminal and confirm, or pass `--max-usd <amount>`. |

### MCP server and AI tools

| Symptom | Cause and fix |
|---|---|
| `GET /mcp` returns `405` | Expected. The endpoint accepts `POST` only. Use the `initialize` check in step 4.4. |
| `401` from `/mcp` | The token is missing from the request, or it was revoked or expired. Run `gbrain auth create` again, or check the token name in the tool's config. |
| `pglite_busy` from the CLI | `gbrain serve` holds the database. Use the MCP tools, or stop the server to run the CLI command. |
| Tool shows `gbrain` as failed | The server is not running, the token is not in the tool's launch environment, or an old stdio `gbrain serve` entry is still present. Fix each in that order. |
| `think` answers "no information" but search finds pages | The question's wording misses the page text. Search by a distinctive term, and check that `CHAT`/`EXPANSION` model variables are set in the server's `.env`. |

## Further reading

### Slack via MCP

The Slack connector reads the enabled remote `slack` server in your Kilo
configuration. Complete authentication there first. Credentials are read at
runtime, never copied into the source config or displayed in the admin panel.

```bash
bun src/cli.ts sources add slack --kind slack \
  --channels C12345678,C23456789 \
  --mcp-config ~/.config/kilo/kilo.jsonc --mcp-server slack
bun src/cli.ts sync --source slack --no-embed
```

Channel archive URLs are also accepted. **Connections > Slack > Verify MCP**
checks authentication and tool availability without downloading Slack messages.
This is not a new OAuth client: provider authorization stays with the configured
MCP server. This initial implementation supports Streamable HTTP and configured
request headers; it does not reuse a harness's separate OAuth token store.

Requests are sequential and paced at least 65 seconds apart. Failed requests stop
that channel without immediate retry. Managed sources checkpoint each imported
page and resume unfinished pagination. A completed channel is re-read next run.

The current MCP renders history as text without exact message timestamps or
permalinks. Thread replies cannot be retrieved reliably: snapshots explicitly
record `coverage: history-only`, and sync reports partial if reply-bearing threads
exist. No exact IDs are inferred from display times or cursor internals.
MCP evidence lives under `slack-mcp/`; existing richer per-day Slack imports are
retained unchanged. Old MCP page tails are retained rather than automatically
deleted when pagination shrinks. No attachment downloads are performed.
Use `gbrain embed --stale --catch-up --source slack` separately when ready to
send Slack text to your configured embedding provider.

- [GitHub source reference](../guides/github-source.md): webhooks for instant
  updates, page format, held items, rate limits.
- [Embedding providers](../integrations/embedding-providers.md): OpenAI,
  Voyage, local Ollama and the other supported providers.
- [Troubleshooting](../guides/troubleshooting.md): everything else.
