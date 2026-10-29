import {connectMcpSource,type McpSourceResult} from '../mcp-source.ts';
import type {ConfluenceSourceConfig} from './source-config.ts';

/** Read-only Confluence tools this connector may call. Writes are never allowlisted. */
export const CONFLUENCE_READ_TOOLS=['confluence-search','confluence-read-page'] as const;
export const connectConfluenceMcp=(cfg:ConfluenceSourceConfig)=>connectMcpSource(cfg,CONFLUENCE_READ_TOOLS);

export function confluenceText(result:McpSourceResult):string{
  if(result.isError)throw new Error('Confluence MCP refused the read. Check authentication, permissions and rate limits.');
  const text=(result.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join('\n');
  if(!text.trim())throw new Error('Confluence MCP returned an empty response.');
  return text;
}

export interface ConfluenceSearchPage{ids:string[];urls:Map<string,string>;nextCursor?:string;hasMore:boolean}

/**
 * Parses `# Confluence Search Results`. Only page IDs are taken from the
 * `Page ID:` lines; cursors are opaque and passed back unchanged. A missing
 * cursor with `Has More: Yes` is an error rather than a silent end of results.
 */
export function parseConfluenceSearch(text:string):ConfluenceSearchPage{
  if(!text.startsWith('# Confluence Search Results\n'))throw new Error('Unexpected Confluence search response.');
  const returned=Number(text.match(/^\*\*Returned:\*\* (\d+)$/m)?.[1]);
  const hasMore=text.match(/^\*\*Has More:\*\* (Yes|No)$/m)?.[1];
  if(!Number.isFinite(returned)||!hasMore)throw new Error('Confluence search response is missing counts or pagination.');
  const ids=[...text.matchAll(/^\s+- Page ID: (\d+)$/gm)].map(m=>m[1]!);
  if(ids.length!==returned)throw new Error('Confluence search count does not match its page IDs.');
  if(new Set(ids).size!==ids.length)throw new Error('Confluence search returned duplicate page IDs.');
  // Each result's URL is what confluence-read-page requires; pair it with its ID.
  const urls=new Map<string,string>();
  for(const m of text.matchAll(/^\s+- Page ID: (\d+)\n\s+- Type: \S+\n\s+- URL: (https:\/\/\S+)$/gm)){
    const url=new URL(m[2]!);
    if(url.username||url.password||url.search||url.hash)throw new Error('Confluence search returned an unsafe page URL.');
    urls.set(m[1]!,url.toString());
  }
  if(urls.size!==ids.length)throw new Error('Confluence search results do not all include readable page URLs.');
  const cursor=text.match(/^\*\*Next Cursor:\*\* (\S+)$/m)?.[1];
  if(hasMore==='Yes'&&!cursor)throw new Error('Confluence search reports more results without a cursor.');
  return {ids,urls,nextCursor:cursor,hasMore:hasMore==='Yes'};
}

export interface ConfluencePage{id:string;title:string;version?:number;updated?:string;markdown:string}

/**
 * Parses `confluence-read-page` output: `Title:`, `Version:`, optional
 * `Updated:` lines, then the body. The output does not repeat the page ID, so
 * the ID the caller requested is recorded as the page identity.
 */
export function parseConfluencePage(text:string,expectedId:string):ConfluencePage{
  const lines=text.split('\n');
  const title=lines[0]?.match(/^Title: (.+)$/)?.[1];
  const versionLine=lines[1]?.match(/^Version: (\d+)$/);
  if(!title||!versionLine)throw new Error('Confluence page response is missing its title or version.');
  let index=2;let updated:string|undefined;
  if(lines[index]?.startsWith('Updated: ')){updated=lines[index]!.slice('Updated: '.length);index++;}
  if(lines[index]!=='')throw new Error('Confluence page response has an unexpected layout.');
  const markdown=lines.slice(index+1).join('\n').trim();
  // The read tool does not echo the ID, so the caller-provided ID is the identity.
  return {id:expectedId,title,version:Number(versionLine[1]),updated,markdown};
}
