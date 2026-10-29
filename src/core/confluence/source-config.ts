import {resolve} from 'node:path';
import type {McpSourceConfig} from '../mcp-source.ts';

/**
 * A Confluence selection is explicit: a space key, optionally narrowed by a text
 * query. The first version supports space scope only; the tree tool returns page
 * IDs without URLs, which the read tool requires, so root-page selection is deferred.
 */
export interface ConfluenceSourceConfig extends McpSourceConfig {
  dir:string;
  space:string;
  query?:string;
}

export function parseConfluenceSourceConfig(raw:Record<string,unknown>,fallbackDir:string):ConfluenceSourceConfig{
  const space=typeof raw.confluence_space==='string'?raw.confluence_space.trim().toUpperCase():undefined;
  const query=typeof raw.confluence_query==='string'?raw.confluence_query.trim():undefined;
  if(!space)throw new Error('Confluence requires an explicit --space <KEY> selection.');
  if(!/^[A-Z][A-Z0-9_]*$/.test(space))throw new Error('Confluence --space must be a space key.');
  if(query!==undefined&&(query.length===0||query.length>1000))throw new Error('Confluence --query must be 1 to 1000 characters.');
  if(typeof raw.confluence_mcp_config!=='string'||!raw.confluence_mcp_config.trim())throw new Error('Confluence requires --mcp-config pointing to an existing authenticated MCP connection.');
  const mcpServer=raw.confluence_mcp_server??'confluence';
  if(typeof mcpServer!=='string'||!mcpServer.trim())throw new Error('Confluence --mcp-server must be a nonempty server name.');
  return {
    dir:resolve(String(raw.confluence_dir??fallbackDir)),
    space,query,
    mcpConfig:resolve(raw.confluence_mcp_config),mcpServer,
  };
}
