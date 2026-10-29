/** Jira issues and comments share one stable, source-scoped Markdown page per key. */
import {join,dirname} from 'node:path';
import type {BrainEngine} from '../engine.ts';
import type {SyncOpts,SyncResult} from '../../commands/sync.ts';
import {withConnectorSync,pendingConnectorResult,rethrowConnectorWriteError} from '../persistence/connector-sync.ts';
import {importFromContent} from '../import-file.ts';
import {atomicWriteFileSync,mkdirPrivate} from '../atomic-write.ts';
import {connectJiraMcp,jiraText,parseJiraSearch,validateJiraIssue,parseJiraComments} from './mcp.ts';
import type {JiraSourceConfig} from './source-config.ts';
import type {McpSourceConnection} from '../mcp-source.ts';

// Sequential calls spaced 1s apart; per-issue failures are logged and retried.
export const JIRA_MCP_INTERVAL_MS=1000;

interface JiraCheckpoint {
  site?:string;token?:string;queue:string[];index:number;seenTokens:string[];
  failedKeys:string[];complete:boolean;
}
export interface JiraSyncDeps {
  connect?:(cfg:JiraSourceConfig)=>Promise<McpSourceConnection>;
  sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;
  now?:()=>number;
}
async function pause(ms:number,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();if(ms<=0)return;
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('Jira sync cancelled'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}

export async function runJiraSync(engine:BrainEngine,sourceId:string,cfg:JiraSourceConfig,opts:SyncOpts,deps:JiraSyncDeps={}):Promise<SyncResult>{
  return withConnectorSync(engine,sourceId,'jira',cfg,opts,async(session,options)=>{
    const result:SyncResult={status:'synced',fromCommit:null,toCommit:'jira-mcp',renamed:0,pagesAffected:[],added:0,modified:0,deleted:0,chunksCreated:0,embedded:0};
    if(options.dryRun)return result;
    const client=await(deps.connect??connectJiraMcp)(cfg);
    try{
      const empty=():JiraCheckpoint=>({queue:[],index:0,seenTokens:[],failedKeys:[],complete:false});
      let state=session?session.state(empty()):empty();
      if(options.full||state.complete)state=empty();
      let lastCall=0;let accountChecked=false;
      const now=deps.now??Date.now;
      const call=async(name:string,args:Record<string,unknown>)=>{
        options.signal?.throwIfAborted();
        await(deps.sleep??pause)(Math.max(0,JIRA_MCP_INTERVAL_MS-(now()-lastCall)),options.signal);
        lastCall=now();return jiraText(await client.call(name,args,options.signal));
      };
      const persist=async()=>{if(session&&accountChecked)await session.saveState(state,false);};
      const checkAccount=async(site:string)=>{
        if(state.site&&state.site!==site)throw new Error('Jira MCP switched sites during ingestion; no further pages were imported.');
        if(session)await session.assertAccount({kind:'jira',site});
        state.site=site;accountChecked=true;
      };
      const ingest=async(key:string)=>{
        const site=state.site!;
        const issue=await call('jira-read-issue',{issueKeyOrId:key});
        validateJiraIssue(issue,key,site);
        const comments:string[]=[];
        let page:number|undefined=1;
        while(page!==undefined){
          const parsed=parseJiraComments(await call('jira-read-comments',{issueKeyOrId:key,page,resultsPerPage:100}),key,site,page);
          comments.push(parsed.text);page=parsed.next;
        }
        const path=`jira/${key.toLowerCase()}.md`;
        const content=`---\ntitle: ${JSON.stringify(issue.split('\n')[0]!.slice(2))}\ntype: jira\nissue_key: ${key}\nurl: ${JSON.stringify(`${site}/browse/${key}`)}\ncomments_complete: true\n---\n\n${issue}\n\n${comments.join('\n\n')}\n`;
        const slug=path.slice(0,-3);
        const prior=session?await session.page(slug):await engine.getPage(slug,{sourceId});
        const imported=session?await session.importMarkdown(path,content):await importFromContent(engine,slug,content,{sourceId,sourcePath:path,noEmbed:true,source_kind:'connector',ingested_via:'jira-mcp'});
        if(imported.status==='error')throw new Error('Jira page import failed.');
        if(!session){mkdirPrivate(dirname(join(cfg.dir,path)),cfg.dir);atomicWriteFileSync(join(cfg.dir,path),content,{mode:0o600});}
        if(imported.status!=='skipped'){if(prior)result.modified++;else result.added++;result.chunksCreated+=imported.chunks;result.pagesAffected.push(slug);}
      };
      const tryIssue=async(key:string)=>{
        try{await ingest(key);state.failedKeys=state.failedKeys.filter(k=>k!==key);}
        catch(error){rethrowConnectorWriteError(error);if(options.signal?.aborted)throw error;
          // Do not echo remote responses: comments and tool errors can contain private text or credentials.
          console.error(`[jira-mcp] ${key}: issue/comments import failed; retained previous page and queued retry`);
          if(!state.failedKeys.includes(key))state.failedKeys.push(key);
        }
      };
      // Establish the site using a bounded search even when resuming a pending issue queue.
      if(state.site)await checkAccount(parseJiraSearch(await call('jira-search',{query:cfg.jql,projectKey:cfg.project,resultsPerPage:1})).site);
      const retries=[...state.failedKeys];
      for(const key of retries){await tryIssue(key);await persist();}
      let more=true;
      while(more){
        if(state.index>=state.queue.length){
          if(state.queue.length&&!state.token)break;
          const found=parseJiraSearch(await call('jira-search',{query:cfg.jql,projectKey:cfg.project,resultsPerPage:50,...(state.token?{nextPageToken:state.token}:{})}));
          await checkAccount(found.site);
          if(found.nextToken&&state.seenTokens.includes(found.nextToken))throw new Error('Jira MCP repeated a continuation token; ingestion stopped.');
          if(found.nextToken)state.seenTokens.push(found.nextToken);
          state.queue=found.keys;state.index=0;state.token=found.nextToken;await persist();
          if(!found.keys.length)break;
        }
        while(state.index<state.queue.length){
          await tryIssue(state.queue[state.index]!);state.index++;await persist();
        }
        more=!!state.token;
      }
      result.failedFiles=state.failedKeys.length;
      if(result.failedFiles){result.status='partial';result.reason='connector_item_failures';}
      state.complete=!result.failedFiles;
      if(session&&accountChecked)await session.saveState(state,state.complete,new Date().toISOString());
      if(!session&&state.complete)await engine.executeRaw('UPDATE sources SET last_sync_at=NOW() WHERE id=$1',[sourceId]);
      return result;
    }finally{await client.close();}
  },pendingConnectorResult);
}
