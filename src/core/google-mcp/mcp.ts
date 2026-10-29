import {connectMcpSource,type McpSourceResult} from '../mcp-source.ts';
import type {GoogleMcpSourceConfig} from './source-config.ts';
export const GOOGLE_MCP_READ_TOOLS=['google-search-gmail-messages','google-read-gmail-message'] as const;
export const connectGoogleMcp=(cfg:GoogleMcpSourceConfig)=>connectMcpSource(cfg,[...(cfg.query?GOOGLE_MCP_READ_TOOLS:[]),...(cfg.calendarId?['google-list-events']:[])]);
export function googleMcpText(result:McpSourceResult):string{
  if(result.isError)throw new Error('Google MCP read failed. Check authentication, scopes and quota before retrying.');
  const text=(result.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join('\n');
  if(!text.trim())throw new Error('Google MCP returned no text.');
  return text;
}
export function parseGmailSearch(text:string):{ids:string[];next?:string}{
  const header=text.match(/^# Gmail Messages\n\n\*\*Returned:\*\* (\d+)\n\*\*Next Page Token:\*\* (\S+)\n\n/);
  if(!header)throw new Error('Google MCP search format is missing counts or pagination.');
  const ids=[...text.slice(header[0].length).matchAll(/^   message id: ([a-fA-F0-9]+) — thread id: [a-fA-F0-9]+\s*$/gm)].map(m=>m[1]!);
  if(ids.length!==Number(header[1])||new Set(ids).size!==ids.length)throw new Error('Google MCP message count does not match its returned IDs.');
  const next=header[2]==='none'?undefined:header[2];
  if(next&&!ids.length)throw new Error('Google MCP returned an empty page with a continuation token.');
  return {ids,next};
}
export function parseGmailMessage(text:string,id:string):{text:string;threadId:string;subject:string;truncated:boolean}{
  const split=text.indexOf('\n\n## Body\n\n');
  if(!text.startsWith('# Gmail Message\n\n')||split<0)throw new Error('Google MCP did not return the requested message body.');
  const metadata=text.slice(0,split);
  const field=(name:string)=>metadata.match(new RegExp(`^\\*\\*${name}:\\*\\* (.+)$`,'m'))?.[1];
  if(field('Message ID')!==id)throw new Error('Google MCP returned a different message ID.');
  const threadId=field('Thread ID');
  if(!threadId||!/^[a-fA-F0-9]+$/.test(threadId))throw new Error('Google MCP returned an invalid thread ID.');
  const body=text.slice(split+'\n\n## Body\n\n'.length);
  const flag=body.match(/^\*\*Truncated:\*\* (yes|no)\n\n/);
  if(!flag)throw new Error('Google MCP omitted message truncation status.');
  return {text,threadId,subject:field('Subject')??id,truncated:flag[1]==='yes'};
}

export function parseCalendarPage(text:string,calendarId:string):{count:number;next?:string}{
  const header=text.match(/^# Google Calendar Events\n\n\*\*Calendar:\*\* (.+)\n\*\*Time Zone:\*\* (.+)\n\*\*Returned:\*\* (\d+)\n\*\*Next Page Token:\*\* (\S+)\n\n/);
  if(!header||header[1]!==calendarId)throw new Error('Google MCP calendar response lacks expected identity/count/pagination.');
  const count=Number(header[3]);
  if([...text.slice(header[0].length).matchAll(/^   id: /gm)].length!==count)throw new Error('Google MCP calendar count does not match event IDs.');
  const next=header[4]==='none'?undefined:header[4];
  if(next&&!count)throw new Error('Empty calendar page has a continuation token.');
  return {count,next};
}
