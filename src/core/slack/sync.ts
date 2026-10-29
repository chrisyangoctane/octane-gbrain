/** MCP history snapshots preserve raw evidence without inventing missing message IDs. */
import {join} from 'node:path';
import type {BrainEngine} from '../engine.ts';
import type {SyncOpts,SyncResult} from '../../commands/sync.ts';
import {withConnectorSync,pendingConnectorResult,rethrowConnectorWriteError} from '../persistence/connector-sync.ts';
import {importFromContent} from '../import-file.ts';
import {atomicWriteFileSync,mkdirPrivate} from '../atomic-write.ts';
import {connectSlackMcp,structuredPage,type SlackMcpConnection,type SlackMcpResult} from './mcp.ts';
import type {SlackSourceConfig} from './source-config.ts';

interface ChannelCheckpoint {cursor?:string;pages:number;messages:number;threads:number;complete:boolean;replyPages:number;replies?:number;repliesDone?:string[]}
interface SlackCheckpoint {lastCall:number;channels:Record<string,ChannelCheckpoint>}
export const SLACK_MCP_INTERVAL_MS=65000;
export interface SlackSyncDependencies {
  connect?:typeof connectSlackMcp;
  sleep?:(ms:number,signal?:AbortSignal)=>Promise<void>;
  now?:()=>number;
}
const sleep=async(ms:number,signal?:AbortSignal)=>{
  if(ms<=0)return;
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(new Error('Slack sync cancelled'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  });
};

export async function runSlackSync(engine:BrainEngine,sourceId:string,cfg:SlackSourceConfig,opts:SyncOpts,deps:SlackSyncDependencies={}):Promise<SyncResult>{
  return withConnectorSync(engine,sourceId,'slack',cfg,opts,async(session,options)=>{
    const result:SyncResult={status:'synced',fromCommit:null,toCommit:'slack-mcp',renamed:0,pagesAffected:[],added:0,modified:0,deleted:0,chunksCreated:0,embedded:0};
    if(options.dryRun)return result;
    const client:SlackMcpConnection=await(deps.connect??connectSlackMcp)(cfg);
    try{
      if(session)await session.assertAccount({kind:'slack',workspace:client.identity});
      const state:SlackCheckpoint=session?session.state({lastCall:0,channels:{}}):{lastCall:0,channels:{}};
      const now=deps.now??Date.now;
      const persist=async()=>{if(session)await session.saveState(state,false);};
      const emit=async(channel:string,path:string,body:string,meta:Record<string,string|number|boolean>)=>{
        const lines=Object.entries({...meta}).filter(([,v])=>v!==undefined).map(([k,v])=>`${k}: ${typeof v==='string'?JSON.stringify(v):v}`).join('\n');
        const content=`---\n${lines}\n---\n\n${body}\n`;
        const slug=path.replace(/\.md$/,'');
        const prior=session?await session.page(slug):await engine.getPage(slug,{sourceId});
        const imported=session?await session.importMarkdown(path,content):await importFromContent(engine,slug,content,{sourceId,noEmbed:true,sourcePath:path,source_kind:'connector',ingested_via:'slack-mcp'});
        if(imported.status==='error')throw new Error('Slack MCP page import failed.');
        if(!session){mkdirPrivate(join(cfg.dir,path.split('/').slice(0,-1).join('/')),cfg.dir);atomicWriteFileSync(join(cfg.dir,path),content,{mode:0o600});}
        if(imported.status!=='skipped'){if(prior)result.modified++;else result.added++;result.chunksCreated+=imported.chunks;result.pagesAffected.push(slug);}
      };
      const paced=async(args:Record<string,unknown>,call:(a:Record<string,unknown>)=>Promise<SlackMcpResult>)=>{
        options.signal?.throwIfAborted();
        await(deps.sleep??sleep)(Math.max(0,SLACK_MCP_INTERVAL_MS-(now()-state.lastCall)),options.signal);
        state.lastCall=now();await persist();
        return call(args);
      };
      for(const channel of cfg.channels){
        let cp=state.channels[channel];
        if(options.full||!cp||cp.complete)cp=state.channels[channel]={pages:0,messages:0,threads:0,complete:false,replyPages:0};
        try{
          // Main history: every page is stored with exact ts/thread_ts.
          do{
            const raw=await paced({channel_id:channel,limit:200,include_all_metadata:true,...(cp.cursor?{cursor:cp.cursor}:{})},a=>client.history(a,options.signal));
            const page=structuredPage(raw);
            if(page.next_cursor&&page.next_cursor===cp.cursor)throw new Error('Slack MCP repeated a cursor; pagination stopped.');
            const n=String(cp.pages+1).padStart(6,'0');
            const body=page.messages.map(m=>`**${m.user??m.bot_id??'unknown'}** ${m.ts??'no-ts'} — ${m.text}${m.is_thread_parent?` (thread, ${m.reply_count} replies)`:''}`).join('\n\n');
            await emit(channel,`slack-mcp/${channel.toLowerCase()}/history-${n}`,body,{title:`Slack ${channel} history ${cp.pages+1}`,type:'slack',channel_id:channel,coverage:'history',thread_replies_imported:false,message_count:page.messages.length});
            cp.pages++;cp.messages+=page.messages.length;
            cp.threads+=page.messages.filter(m=>m.is_thread_parent&&m.reply_count>0).length;
            // Replies are checkpointed per parent so a restart resumes instead of refetching.
            for(const parent of page.messages.filter(m=>m.is_thread_parent&&m.reply_count>0&&m.ts)){
              const key=`${channel}:${parent.ts}`;
              if(cp.repliesDone?.includes(key))continue;
              let rc:string|undefined;
              do{
                const rr=await paced({channel_id:channel,thread_ts:parent.ts,limit:200,...(rc?{cursor:rc}:{})},a=>client.replies(a,options.signal));
                const rpage=structuredPage(rr);
                const rn=String(++cp.replyPages).padStart(6,'0');
                const rbody=rpage.messages.map(m=>`**${m.user??m.bot_id??'unknown'}** ${m.ts??'no-ts'} (reply to ${parent.ts}) — ${m.text}`).join('\n\n');
                await emit(channel,`slack-mcp/${channel.toLowerCase()}/replies-${rn}`,rbody,{title:`Slack ${channel} thread ${parent.ts}`,type:'slack',channel_id:channel,thread_ts:parent.ts as string,coverage:'thread',message_count:rpage.messages.length});
                rc=rpage.next_cursor;cp.replies=(cp.replies??0)+rpage.messages.length;
              }while(rc);
              (cp.repliesDone??=[]).push(key);await persist();
            }
            cp.cursor=page.next_cursor;cp.complete=!page.next_cursor;await persist();
          }while(!cp.complete);
          console.error(`[slack-mcp] ${channel}: ${cp.messages} history messages, ${cp.pages} pages; ${cp.replies??0} thread replies from ${cp.repliesDone?.length??0} threads`);
        }catch(error){rethrowConnectorWriteError(error);if(options.signal?.aborted)throw error;console.error(`[slack-mcp] ${channel}: ${(error as Error).message}`);result.failedFiles=(result.failedFiles??0)+1;}
      }
      if(result.failedFiles){result.status='partial';result.reason='connector_item_failures';}
      if(session)await session.saveState(state,result.status==='synced',new Date().toISOString());
      return result;
    }finally{await client.close();}
  },pendingConnectorResult);
}
