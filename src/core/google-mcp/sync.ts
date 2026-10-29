/** Gmail ingestion through the separately configured Google MCP server. */
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {BrainEngine} from '../engine.ts';
import type {SyncOpts,SyncResult} from '../../commands/sync.ts';
import {withConnectorSync,pendingConnectorResult,rethrowConnectorWriteError} from '../persistence/connector-sync.ts';
import {atomicWriteFileSync,mkdirPrivate} from '../atomic-write.ts';
import {importFromContent} from '../import-file.ts';
import type {McpSourceConnection} from '../mcp-source.ts';
import type {GoogleMcpSourceConfig} from './source-config.ts';
import {connectGoogleMcp,googleMcpText,parseGmailSearch,parseGmailMessage,parseCalendarPage} from './mcp.ts';

interface GmailCheckpoint {token?:string;queue:string[];index:number;seen:string[];failed:string[];truncated:string[];complete:boolean;calendar?:{token?:string;pages:number;events:number;seen:string[];complete:boolean}}
export interface GoogleMcpSyncDeps {connect?:(cfg:GoogleMcpSourceConfig)=>Promise<McpSourceConnection>;sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;now?:()=>number}
async function pause(ms:number,signal?:AbortSignal):Promise<void>{
  signal?.throwIfAborted();if(ms<=0)return;
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('Google MCP sync cancelled'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });
}
export async function runGoogleMcpSync(engine:BrainEngine,sourceId:string,cfg:GoogleMcpSourceConfig,opts:SyncOpts,deps:GoogleMcpSyncDeps={}):Promise<SyncResult>{
  return withConnectorSync(engine,sourceId,'google-mcp',cfg,opts,async(session,options)=>{
    const result:SyncResult={status:'synced',fromCommit:null,toCommit:'google-mcp',renamed:0,pagesAffected:[],added:0,modified:0,deleted:0,chunksCreated:0,embedded:0};
    if(options.dryRun)return result;
    const client=await(deps.connect??connectGoogleMcp)(cfg);
    try{
      // The MCP has no profile tool: this pin binds declared account + endpoint,
      // not a verified provider identity. Never infer the mailbox from From/To.
      if(session)await session.assertAccount({kind:'google-mcp',connection:client.identity,account:cfg.account});
      const empty=():GmailCheckpoint=>({queue:[],index:0,seen:[],failed:[],truncated:[],complete:false});
      let state=session?session.state(empty()):empty();if(options.full||state.complete)state=empty();
      let last=0;const now=deps.now??Date.now;
      const call=async(name:string,args:Record<string,unknown>)=>{
        options.signal?.throwIfAborted();await(deps.sleep??pause)(Math.max(0,1500-(now()-last)),options.signal);last=now();
        return googleMcpText(await client.call(name,args,options.signal));
      };
      const persist=async()=>{if(session)await session.saveState(state,false);};
      const ingest=async(id:string)=>{
        try{
          const message=parseGmailMessage(await call('google-read-gmail-message',{messageId:id,includeBody:true}),id);
          const path=`gmail-mcp/${id.toLowerCase()}.md`;const slug=path.slice(0,-3);
          const content=`---\ntitle: ${JSON.stringify(message.subject)}\ntype: gmail\nmessage_id: ${id}\nthread_id: ${message.threadId}\naccount: ${JSON.stringify(cfg.account)}\nbody_truncated: ${message.truncated}\nidentity_verified: false\n---\n\n${message.text}\n`;
          const prior=session?await session.page(slug):await engine.getPage(slug,{sourceId});
          const imported=session?await session.importMarkdown(path,content):await importFromContent(engine,slug,content,{sourceId,sourcePath:path,noEmbed:true,source_kind:'connector',ingested_via:'google-mcp'});
          if(imported.status==='error')throw new Error('Google MCP message import failed.');
          if(!session){mkdirPrivate(dirname(join(cfg.dir,path)),cfg.dir);atomicWriteFileSync(join(cfg.dir,path),content,{mode:0o600});}
          if(imported.status!=='skipped'){if(prior)result.modified++;else result.added++;result.chunksCreated+=imported.chunks;result.pagesAffected.push(slug);}
          state.failed=state.failed.filter(x=>x!==id);state.truncated=state.truncated.filter(x=>x!==id);
          if(message.truncated)state.truncated.push(id);
        }catch(error){rethrowConnectorWriteError(error);if(options.signal?.aborted)throw error;
          console.error(`[google-mcp] ${id}: message import failed; queued retry`);if(!state.failed.includes(id))state.failed.push(id);
        }
      };
      for(const id of [...state.failed]){await ingest(id);await persist();}
      let more=!!cfg.query;
      while(more){
        if(state.index>=state.queue.length){
          if(state.queue.length&&!state.token)break;
          const found=parseGmailSearch(await call('google-search-gmail-messages',{query:cfg.query,pageSize:100,...(state.token?{pageToken:state.token}:{})}));
          if(found.next&&state.seen.includes(found.next))throw new Error('Google MCP repeated a page token.');
          if(found.next)state.seen.push(found.next);
          state.queue=found.ids;state.index=0;state.token=found.next;await persist();if(!found.ids.length)break;
        }
        while(state.index<state.queue.length){await ingest(state.queue[state.index]!);state.index++;await persist();}
        more=!!state.token;
      }
      if(cfg.calendarId){
        const cp=state.calendar??={pages:0,events:0,seen:[],complete:false};
        while(!cp.complete){
          const body=await call('google-list-events',{calendarId:cfg.calendarId,timeMin:cfg.timeMin,timeMax:cfg.timeMax,maxResults:250,...(cp.token?{pageToken:cp.token}:{})});
          const page=parseCalendarPage(body,cfg.calendarId);
          if(page.next&&cp.seen.includes(page.next))throw new Error('Google MCP calendar repeated a page token.');
          const selection=createHash('sha256').update(JSON.stringify([cfg.calendarId,cfg.timeMin,cfg.timeMax])).digest('hex').slice(0,16);
          const path=`calendar-mcp/${selection}/page-${String(cp.pages+1).padStart(6,'0')}.md`;const slug=path.slice(0,-3);
          const content=`---\ntitle: ${JSON.stringify(`Calendar ${cfg.calendarId} ${cfg.timeMin} to ${cfg.timeMax} page ${cp.pages+1}`)}\ntype: calendar\ncalendar_id: ${JSON.stringify(cfg.calendarId)}\ntime_min: ${JSON.stringify(cfg.timeMin)}\ntime_max: ${JSON.stringify(cfg.timeMax)}\nevent_count: ${page.count}\ncoverage: event-summaries\nidentity_verified: false\n---\n\n${body}\n`;
          const prior=session?await session.page(slug):await engine.getPage(slug,{sourceId});
          const imported=session?await session.importMarkdown(path,content):await importFromContent(engine,slug,content,{sourceId,sourcePath:path,noEmbed:true,source_kind:'connector',ingested_via:'google-mcp'});
          if(imported.status==='error')throw new Error('Google MCP calendar import failed.');
          if(!session){mkdirPrivate(dirname(join(cfg.dir,path)),cfg.dir);atomicWriteFileSync(join(cfg.dir,path),content,{mode:0o600});}
          if(imported.status!=='skipped'){if(prior)result.modified++;else result.added++;result.chunksCreated+=imported.chunks;result.pagesAffected.push(slug);}
          cp.pages++;cp.events+=page.count;cp.token=page.next;cp.complete=!page.next;if(page.next)cp.seen.push(page.next);await persist();
        }
        console.error(`[google-mcp] Calendar: ${cp.events} event summaries, ${cp.pages} pages; descriptions and attendees are not exposed by the MCP.`);
      }
      result.failedFiles=state.failed.length;state.complete=!state.failed.length;
      if(state.failed.length){result.status='partial';result.reason='connector_item_failures';}
      else if(state.truncated.length){result.status='partial';result.reason='connector_partial';console.error(`[google-mcp] ${state.truncated.length} message bodies were truncated by the MCP; complete bodies are unavailable.`);}
      if(session)await session.saveState(state,result.status==='synced',new Date().toISOString());
      if(!session&&result.status==='synced')await engine.executeRaw('UPDATE sources SET last_sync_at=NOW() WHERE id=$1',[sourceId]);
      return result;
    }finally{await client.close();}
  },pendingConnectorResult);
}
