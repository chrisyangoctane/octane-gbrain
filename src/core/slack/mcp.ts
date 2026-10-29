/** Read-only MCP transport. Credentials stay in the operator's existing client config. */
import {readMcpSourceConfig,connectMcpSource} from '../mcp-source.ts';
import type { SlackSourceConfig } from './source-config.ts';

export interface SlackMcpResult { content?: Array<{type:string;text?:string}>; structuredContent?: Record<string,unknown>; isError?:boolean }
export interface SlackMcpConnection {
  identity:string;
  history(args:Record<string,unknown>,signal?:AbortSignal):Promise<SlackMcpResult>;
  replies(args:Record<string,unknown>,signal?:AbortSignal):Promise<SlackMcpResult>;
  close():Promise<void>;
}

export interface StructuredSlackMessage { ts?:string; thread_ts?:string; is_thread_parent:boolean; reply_count:number; user?:string; bot_id?:string; subtype?:string; text:string; files:Array<Record<string,unknown>> }
export interface StructuredSlackPage { messages:StructuredSlackMessage[]; next_cursor?:string; has_more:boolean }

export function readSlackMcpConfig(cfg:Pick<SlackSourceConfig,'mcpConfig'|'mcpServer'>):{url:URL;headers:Record<string,string>} {
  return readMcpSourceConfig(cfg);
}

export async function connectSlackMcp(cfg:SlackSourceConfig):Promise<SlackMcpConnection> {
  const client=await connectMcpSource(cfg,['slack-conversations-history','slack-conversations-replies']);
  return {
    identity:client.identity,
    async history(args,signal){
      try {return await client.call('slack-conversations-history',args,signal);}
      catch {throw new Error('Slack MCP history request failed; retry this source after checking the MCP server.');}
    },
    async replies(args,signal){
      try {return await client.call('slack-conversations-replies',args,signal);}
      catch {throw new Error('Slack MCP replies request failed; retry this source after checking the MCP server.');}
    },
    close:()=>client.close(),
  };
}

/** Exact-identifier page from the upgraded server; refuses the legacy text-only format. */
export function structuredPage(result:SlackMcpResult):StructuredSlackPage {
  if(result.isError)throw new Error('Slack MCP returned a tool error; checkpoint was not advanced.');
  const page=result.structuredContent as Partial<StructuredSlackPage>|undefined;
  if(!page||!Array.isArray(page.messages))throw new Error('Slack MCP did not return structured messages; upgrade the Slack MCP server before importing.');
  if(page.messages.some(m=>m.ts!==undefined&&typeof m.ts!=='string'))throw new Error('Structured Slack message has an invalid ts.');
  return {messages:page.messages,next_cursor:page.next_cursor,has_more:page.has_more===true};
}

/** Legacy text-only parser, kept for tests and old servers. */
export function parseSlackHistory(result:SlackMcpResult):{text:string;count:number;threads:number;cursor?:string} {
  const text=(result.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join('\n');
  if(/rate.?limit|throttl|retry.after|\b429\b/i.test(text.slice(0,500)))throw new Error('Slack MCP reported rate limiting. This channel stopped without retry; resume after the server retry interval.');
  if(result.isError)throw new Error('Slack MCP returned a tool error; channel checkpoint was not advanced.');
  const count=text.match(/\*\*Messages\*\* \(showing (\d+)\)/)?.[1];
  if(count===undefined)throw new Error('Unrecognized Slack MCP history format; channel checkpoint was not advanced.');
  const threads=[...text.matchAll(/\*\*Thread Replies\*\*:\s*(\d+)/g)].filter(m=>Number(m[1])>0).length;
  return {text,count:Number(count),threads,cursor:text.match(/\*\*Next Cursor\*\*:\s*(\S+)/)?.[1]};
}
