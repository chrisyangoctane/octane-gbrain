import {resolve} from 'node:path';
import type {McpSourceConfig} from '../mcp-source.ts';
export interface JiraSourceConfig extends McpSourceConfig {dir:string;jql:string;project?:string}
export function parseJiraSourceConfig(raw:Record<string,unknown>,fallbackDir:string):JiraSourceConfig{
  const jql=typeof raw.jira_jql==='string'?raw.jira_jql.trim():'';
  const project=typeof raw.jira_project==='string'?raw.jira_project.trim().toUpperCase():undefined;
  if(!jql||jql.length>16000)throw new Error('Jira requires an explicit --jql selection (up to 16000 characters).');
  if(project&&!/^[A-Z][A-Z0-9_]*$/.test(project))throw new Error('Jira --project must be a project key.');
  if(typeof raw.jira_mcp_config!=='string'||!raw.jira_mcp_config.trim())throw new Error('Jira requires --mcp-config pointing to an existing authenticated MCP connection.');
  const mcpServer=raw.jira_mcp_server??'jira';
  if(typeof mcpServer!=='string'||!mcpServer.trim())throw new Error('Jira --mcp-server must be a nonempty server name.');
  return {dir:resolve(String(raw.jira_dir??fallbackDir)),jql,project,mcpConfig:resolve(raw.jira_mcp_config),mcpServer};
}
