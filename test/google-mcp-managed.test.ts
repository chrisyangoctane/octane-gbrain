import {beforeAll,afterAll,test,expect} from 'bun:test';
import {createConnectorFixture,options} from './helpers/connector-fixture.ts';
import {withEnv} from './helpers/with-env.ts';
import {runGoogleMcpSync} from '../src/core/google-mcp/sync.ts';
import type {McpSourceConnection} from '../src/core/mcp-source.ts';
const f=createConnectorFixture();beforeAll(f.setup,120000);afterAll(f.teardown);
const text=(s:string)=>({content:[{type:'text',text:s}]});
test('Google MCP paginates, marks truncation, retries and isolates sources',async()=>{
 await withEnv(f.env,async()=>{for(const engine of f.engines){
 const raw={kind:'google-mcp',gm_query:'after:2026/01/01',gm_account:'owner@example.com',gm_mcp_config:'/tmp/mcp.json'};
 const source=await f.source(engine,raw);
 const cfg={dir:source.dir,query:raw.gm_query,account:raw.gm_account,mcpConfig:raw.gm_mcp_config,mcpServer:'google'};
 let fail=true;let truncated=true;const calls:Record<string,unknown>[]=[];
 const client:McpSourceConnection={identity:'https://mcp.example.com/google#google',close:async()=>{},call:async(name,args)=>{
  calls.push(args);
  if(name==='google-search-gmail-messages'){
   const id=args.pageToken?'bb22':'aa11';
   return text(`# Gmail Messages\n\n**Returned:** 1\n**Next Page Token:** ${args.pageToken?'none':'next'}\n\n1. **Example**\n   message id: ${id} — thread id: cc33\n`);
  }
  if(args.messageId==='bb22'&&fail)throw new Error('fixture outage');
  return text(`# Gmail Message\n\n**Message ID:** ${args.messageId}\n**Thread ID:** cc33\n**Subject:** Example\n\n## Body\n\n**Truncated:** ${truncated?'yes':'no'}\n\nExample body`);
 }};
 const deps={connect:async()=>client,sleep:async()=>{}};
 const first=await runGoogleMcpSync(engine,source.id,cfg,options,deps);
 expect(first.status).toBe('partial');expect(first.failedFiles).toBe(1);
 expect((await engine.getPage('gmail-mcp/aa11',{sourceId:source.id}))?.frontmatter.body_truncated).toBe(true);
 fail=false;truncated=false;
 const retry=await runGoogleMcpSync(engine,source.id,cfg,options,deps);
 expect(retry.status).toBe('partial'); // older truncated content remains explicitly incomplete
 const refreshed=await runGoogleMcpSync(engine,source.id,cfg,options,deps);
 expect(refreshed.status).toBe('synced');expect(calls.some(a=>a.pageToken==='next')).toBe(true);
 const again=await runGoogleMcpSync(engine,source.id,cfg,options,deps);expect(again.added+again.modified).toBe(0);
 const other=await f.source(engine,raw);expect(await engine.getPage('gmail-mcp/aa11',{sourceId:other.id})).toBeNull();
 await expect(runGoogleMcpSync(engine,source.id,cfg,options,{...deps,connect:async()=>({...client,identity:'https://other.example.com#google'})})).rejects.toMatchObject({code:'connector_account_changed'});
 }});
},120000);
test('Calendar-only sources paginate and preserve summary coverage',async()=>{
 await withEnv(f.env,async()=>{for(const engine of f.engines){
 const raw={kind:'google-mcp',gm_account:'owner@example.com',gm_calendar_id:'primary',gm_time_min:'2026-10-01T00:00:00Z',gm_time_max:'2026-10-11T00:00:00Z',gm_mcp_config:'/tmp/mcp.json'};
 const source=await f.source(engine,raw);
 const cfg={dir:source.dir,query:'',account:raw.gm_account,mcpConfig:raw.gm_mcp_config,mcpServer:'google',calendarId:'primary',timeMin:raw.gm_time_min,timeMax:raw.gm_time_max};
 const client:McpSourceConnection={identity:'https://mcp.example.com/google#google',close:async()=>{},call:async(name,args)=>{
  expect(name).toBe('google-list-events');expect(args.timeMin).toBe(cfg.timeMin);
  return text(`# Google Calendar Events\n\n**Calendar:** primary\n**Time Zone:** UTC\n**Returned:** 1\n**Next Page Token:** ${args.pageToken?'none':'next'}\n\n1. **Example event** — 2026-10-02\n   id: ${args.pageToken?'second':'first'}`);
 }};
 const result=await runGoogleMcpSync(engine,source.id,cfg,options,{connect:async()=>client,sleep:async()=>{}});
 expect(result.status).toBe('synced');expect(result.added).toBe(2);
 const page=await engine.getPage(result.pagesAffected[0]!,{sourceId:source.id});
 expect(page?.frontmatter.coverage).toBe('event-summaries');expect(page?.compiled_truth).toContain('Example event');
 }});
},120000);
