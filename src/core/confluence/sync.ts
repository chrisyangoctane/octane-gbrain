/** Confluence pages are imported one stable, source-scoped Markdown page per page ID. */
import {join,dirname} from 'node:path';
import type {BrainEngine} from '../engine.ts';
import type {SyncOpts,SyncResult} from '../../commands/sync.ts';
import {withConnectorSync,pendingConnectorResult,rethrowConnectorWriteError} from '../persistence/connector-sync.ts';
import {importFromContent} from '../import-file.ts';
import {atomicWriteFileSync,mkdirPrivate} from '../atomic-write.ts';
import type {McpSourceConnection} from '../mcp-source.ts';
import type {ConfluenceSourceConfig} from './source-config.ts';
import {connectConfluenceMcp,confluenceText,parseConfluenceSearch,parseConfluencePage} from './mcp.ts';

/** Sequential calls spaced 1s apart; per-page failures are logged and retried on later runs. */
export const CONFLUENCE_MCP_INTERVAL_MS=1000;

interface ConfluenceCheckpoint {
  cursor?:string;
  failed:string[];complete:boolean;
}
export interface ConfluenceSyncDeps {connect?:(cfg:ConfluenceSourceConfig)=>Promise<McpSourceConnection>;sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;now?:()=>number}

async function pause(ms:number,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();if(ms<=0)return;
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('Confluence sync cancelled'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}

export async function runConfluenceSync(engine:BrainEngine,sourceId:string,cfg:ConfluenceSourceConfig,opts:SyncOpts,deps:ConfluenceSyncDeps={}):Promise<SyncResult>{
  return withConnectorSync(engine,sourceId,'confluence',cfg,opts,async(session,options)=>{
    const result:SyncResult={status:'synced',fromCommit:null,toCommit:'confluence-mcp',renamed:0,pagesAffected:[],added:0,modified:0,deleted:0,chunksCreated:0,embedded:0};
    if(options.dryRun)return result;
    const client=await(deps.connect??connectConfluenceMcp)(cfg);
    try{
      // The declared scope is pinned: a different space or root under the same
      // endpoint is a different source and must not share checkpoints.
      if(session)await session.assertAccount({kind:'confluence',connection:client.identity,scope:cfg.space??''});
      const empty=():ConfluenceCheckpoint=>({failed:[],complete:false});
      let state=session?session.state(empty()):empty();
      // A completed sweep is read again from its first page; a new sweep starts with no cursor history.
      if(options.full||state.complete)state=empty();
      let last=0;const now=deps.now??Date.now;
      const call=async(name:string,args:Record<string,unknown>)=>{
        options.signal?.throwIfAborted();
        await(deps.sleep??pause)(Math.max(0,CONFLUENCE_MCP_INTERVAL_MS-(now()-last)),options.signal);
        last=now();return confluenceText(await client.call(name,args,options.signal));
      };
      const persist=async()=>{if(session)await session.saveState(state,false);};

      const ingest=async(id:string,url?:string)=>{
        if(!url)throw new Error('Confluence page URL is unavailable for this page.');
        const page=parseConfluencePage(await call('confluence-read-page',{pageUrl:url}),id);
        const path=`confluence/${id}.md`;const slug=path.slice(0,-3);
        const content=`---\ntitle: ${JSON.stringify(page.title)}\ntype: confluence\npage_id: ${id}\nversion: ${page.version}\n${page.updated?`updated: ${JSON.stringify(page.updated)}\n`:''}space: ${cfg.space}\nidentity_verified: false\n---\n\n# ${page.title}\n\n${page.markdown}\n`;
        const prior=session?await session.page(slug):await engine.getPage(slug,{sourceId});
        const imported=session?await session.importMarkdown(path,content):await importFromContent(engine,slug,content,{sourceId,sourcePath:path,noEmbed:true,source_kind:'connector',ingested_via:'confluence-mcp'});
        if(imported.status==='error')throw new Error('Confluence page import failed.');
        if(!session){mkdirPrivate(dirname(join(cfg.dir,path)),cfg.dir);atomicWriteFileSync(join(cfg.dir,path),content,{mode:0o600});}
        if(imported.status!=='skipped'){if(prior)result.modified++;else result.added++;result.chunksCreated+=imported.chunks;result.pagesAffected.push(slug);}
      };
      const tryPage=async(id:string,url?:string)=>{
        try{await ingest(id,url);state.failed=state.failed.filter(x=>x!==id);}
        catch(error){rethrowConnectorWriteError(error);if(options.signal?.aborted)throw error;
          // Do not echo page bodies or server errors; they can contain private text.
          console.error(`[confluence-mcp] page ${id}: import failed; queued retry`);
          if(!state.failed.includes(id))state.failed.push(id);
        }
      };
      // Space scope: search returns each page's URL, which the read tool requires.
      // Retry failed pages from earlier runs first, then paginate with the server's opaque cursor.
      for(const id of [...state.failed])await tryPage(id);await persist();
      let more=true;
      while(more){
        const args:Record<string,unknown>={query:cfg.query??'*',contentType:'page',resultsPerPage:50,spaceKey:cfg.space,...(state.cursor?{cursor:state.cursor}:{})};
        const found=parseConfluenceSearch(await call('confluence-search',args));
        // A cursor is only a loop if the server returns the same cursor it was just asked for.
        if(found.nextCursor&&found.nextCursor===state.cursor)throw new Error('Confluence MCP returned the cursor it was given; ingestion stopped.');
        for(const id of found.ids)await tryPage(id,found.urls.get(id));
        state.cursor=found.nextCursor;more=found.hasMore;await persist();
      }
      result.failedFiles=state.failed.length;state.complete=!state.failed.length;
      if(state.failed.length){result.status='partial';result.reason='connector_item_failures';}
      if(session)await session.saveState(state,state.complete,new Date().toISOString());
      if(!session&&state.complete)await engine.executeRaw('UPDATE sources SET last_sync_at=NOW() WHERE id=$1',[sourceId]);
      return result;
    }finally{await client.close();}
  },pendingConnectorResult);
}
