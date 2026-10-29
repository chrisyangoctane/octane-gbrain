import {connectMcpSource,type McpSourceResult} from '../mcp-source.ts';
import type {JiraSourceConfig} from './source-config.ts';
export const JIRA_READ_TOOLS=['jira-search','jira-read-issue','jira-read-comments'] as const;
export const connectJiraMcp=(cfg:JiraSourceConfig)=>connectMcpSource(cfg,JIRA_READ_TOOLS);

export function jiraText(result:McpSourceResult):string{
  if(result.isError)throw new Error('Jira MCP refused the read. Check authentication, permissions and rate limits.');
  const text=(result.content??[]).filter(c=>c.type==='text').map(c=>c.text??'').join('\n');
  if(!text.trim())throw new Error('Jira MCP returned an empty response.');
  return text;
}
export function jiraSite(text:string):string{
  const value=text.match(/^\s*(?:- )?\*\*Site:\*\*\s*(\S+)\s*$/m)?.[1];
  if(!value)throw new Error('Jira MCP response is missing its site identity.');
  const url=new URL(value);
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Jira MCP returned an invalid site identity.');
  return url.origin;
}
export function jiraPagination(text:string):{page?:number;next?:number}{
  const match=text.match(/\nPagination: page=(\d+|n\/a), next=(\d+|n\/a), prev=(\d+|n\/a)\s*$/);
  if(!match)throw new Error('Jira MCP response is missing pagination metadata; refusing to assume completion.');
  return {page:match[1]==='n/a'?undefined:Number(match[1]),next:match[2]==='n/a'?undefined:Number(match[2])};
}
export function parseJiraSearch(text:string):{site:string;keys:string[];nextToken?:string}{
  if(!text.startsWith('# Jira Search Results\n'))throw new Error('Unexpected Jira search response.');
  const site=jiraSite(text);const pagination=jiraPagination(text);
  // Only parse the issue-list section, never tokens or user-supplied JQL text.
  const list=text.slice(text.indexOf('\n\n')+2,text.lastIndexOf('\nPagination:'));
  const keys=[...list.matchAll(/^\d+\. ([A-Z][A-Z0-9_]*-\d+) — /gm)].map(m=>m[1]!);
  if(!keys.length&&!list.includes('No issues found.'))throw new Error('Jira search items could not be parsed.');
  const nextToken=text.match(/^\*\*nextPageToken:\*\*\s*(\S+)$/m)?.[1];
  if(pagination.next&&!nextToken)throw new Error('Jira search indicates more results but omits its continuation token.');
  if(nextToken&&!keys.length)throw new Error('Jira search returned an empty page with a continuation token.');
  return {site,keys:[...new Set(keys)],nextToken};
}
export function validateJiraIssue(text:string,key:string,site:string):void{
  if(!text.startsWith(`# ${key}: `))throw new Error('Jira issue response does not match the requested issue key.');
  const url=text.match(/^- \*\*URL:\*\*\s*(\S+)\s*$/m)?.[1];
  if(url!==`${site}/browse/${key}`)throw new Error('Jira issue URL does not match the selected site and key.');
}
export function parseJiraComments(text:string,key:string,site:string,page:number):{text:string;next?:number}{
  if(!text.startsWith('# Jira Issue Comments\n')||jiraSite(text)!==site||!text.includes(`- **Issue:** ${key}\n`))throw new Error('Jira comments response does not match the selected site and issue.');
  const pagination=jiraPagination(text);
  if(pagination.page!==page||pagination.next!==undefined&&pagination.next!==page+1)throw new Error('Jira comments returned inconsistent pagination.');
  if(!/^\s*- \*\*Total:\*\*\s*\d+\s*$/m.test(text))throw new Error('Jira comments total is unknown; complete coverage cannot be verified.');
  return {text:text.slice(0,text.lastIndexOf('\nPagination:')).trim(),next:pagination.next};
}
