import {resolve} from 'node:path';
import type {McpSourceConfig} from '../mcp-source.ts';
export interface GoogleMcpSourceConfig extends McpSourceConfig {dir:string;query:string;account:string;calendarId?:string;timeMin?:string;timeMax?:string}
export function parseGoogleMcpSourceConfig(raw:Record<string,unknown>,fallbackDir:string):GoogleMcpSourceConfig{
  const query=typeof raw.gm_query==='string'?raw.gm_query.trim():'';
  const account=typeof raw.gm_account==='string'?raw.gm_account.trim().toLowerCase():'';
  const calendarId=typeof raw.gm_calendar_id==='string'?raw.gm_calendar_id.trim():undefined;
  const timeMin=typeof raw.gm_time_min==='string'?raw.gm_time_min:undefined;
  const timeMax=typeof raw.gm_time_max==='string'?raw.gm_time_max:undefined;
  if((!query&&!calendarId)||query.length>16000)throw new Error('Google MCP requires --gmail-query or an explicit --calendar-id and time window.');
  if(calendarId&&(!timeMin||!timeMax||!Number.isFinite(Date.parse(timeMin))||!Number.isFinite(Date.parse(timeMax))||Date.parse(timeMin)>=Date.parse(timeMax)))throw new Error('Calendar ingestion requires valid --time-min and --time-max in increasing order.');
  if(!calendarId&&(timeMin||timeMax))throw new Error('Calendar time bounds require --calendar-id.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account))throw new Error('Google MCP requires --account to label and isolate the selected mailbox.');
  if(typeof raw.gm_mcp_config!=='string'||!raw.gm_mcp_config.trim())throw new Error('Google MCP requires --mcp-config for an existing authenticated connection.');
  const server=raw.gm_mcp_server??'google';
  if(typeof server!=='string'||!server.trim())throw new Error('Google MCP requires a nonempty server name.');
  return {dir:resolve(String(raw.gm_dir??fallbackDir)),query,account,mcpConfig:resolve(raw.gm_mcp_config),mcpServer:server,...(calendarId?{calendarId,timeMin,timeMax}:{})};
}
