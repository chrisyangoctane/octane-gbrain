import {beforeAll,afterAll,test,expect} from 'bun:test';
import {createConnectorFixture,options} from './helpers/connector-fixture.ts';
import {withEnv} from './helpers/with-env.ts';
import {runSlackSync} from '../src/core/slack/sync.ts';
const f=createConnectorFixture();beforeAll(f.setup,120000);afterAll(f.teardown);
test('MCP snapshots paginate, pace and honestly mark missing replies',async()=>{
 await withEnv(f.env,async()=>{for(const engine of f.engines){
  const s=await f.source(engine,{kind:'slack',slack_channels:'C12345678',slack_mcp_config:'/tmp/config.json'});
  const cfg={dir:s.dir,channels:['C12345678'],mcpConfig:'/tmp/config.json',mcpServer:'slack'};
  let calls=0;const waits:number[]=[];
  const result=await runSlackSync(engine,s.id,cfg,options,{now:()=>100000,sleep:async(ms)=>{waits.push(ms);},connect:async()=>({identity:'https://example.com/mcp#slack',close:async()=>{},history:async(args)=>{calls++;expect(args.cursor).toBe(calls===1?undefined:'next');return {structuredContent:{messages:[{ts:'1792094467.000100',thread_ts:'1792094467.000100',is_thread_parent:true,reply_count:0,user:'U1',text:'Example message',files:[]}],next_cursor:calls===1?'next':undefined,has_more:calls===1}};},replies:async()=>({structuredContent:{messages:[],has_more:false}})})});
  expect(result.status).toBe('synced');expect(calls).toBe(2);expect(waits.some(ms=>ms>0&&ms<=1500)).toBe(true);
  const page=await engine.getPage('slack-mcp/c12345678/history-000001',{sourceId:s.id});
  expect(page?.compiled_truth).toContain('1792094467.000100');expect(page?.compiled_truth).toContain('Example message');
 }});
},120000);
