import { resolve } from 'node:path';
import { homedir } from 'node:os';

export interface SlackSourceConfig {
  dir: string;
  channels: string[];
  mcpConfig: string;
  mcpServer: string;
}

export function slackChannelId(value: string): string {
  const id = value.startsWith('https://') ? new URL(value).pathname.match(/^\/archives\/([CG][A-Z0-9]+)\/?$/)?.[1] : value;
  if (!id || !/^[CG][A-Z0-9]{6,}$/.test(id)) throw new Error('Slack channels must be channel IDs or https channel archive URLs');
  return id;
}

export function parseSlackSourceConfig(raw: Record<string, unknown>, fallbackDir: string): SlackSourceConfig {
  if(raw.slackdump_path && !raw.slack_mcp_config)throw new Error('This legacy Slackdump source is preserved read-only. Register a new Slack MCP source with --mcp-config; existing pages are not replaced.');
  const channels = String(raw.slack_channels ?? '').split(',').filter(Boolean).map(slackChannelId);
  if (!channels.length) throw new Error('Slack source requires --channels');
  return {
    dir: resolve(String(raw.slack_dir ?? fallbackDir)),
    channels: [...new Set(channels)].sort(),
    mcpConfig: resolve(String(raw.slack_mcp_config ?? resolve(homedir(),'.config/kilo/kilo.jsonc'))),
    mcpServer: String(raw.slack_mcp_server ?? 'slack'),
  };
}
