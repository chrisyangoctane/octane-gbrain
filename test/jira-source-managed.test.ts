import {beforeAll,afterAll,test,expect} from 'bun:test';
import {createConnectorFixture,options} from './helpers/connector-fixture.ts';
import {withEnv} from './helpers/with-env.ts';
import {runJiraSync} from '../src/core/jira/sync.ts';
import type {McpSourceConnection} from '../src/core/mcp-source.ts';

const fixture=createConnectorFixture();beforeAll(fixture.setup,120000);afterAll(fixture.teardown);
const site='https://jira.example.com';
function text(value:string){return {content:[{type:'text',text:value}]};}
function search(keys:string[],token?:string){return `# Jira Search Results\n**JQL:** project = EX\n**Site:** ${site}\n**Total:** unknown${token?`\n**nextPageToken:** ${token}`:''}\n\n${keys.map((k,i)=>`${i+1}. ${k} — Example [Open]`).join('\n')||'No issues found.'}\n\nPagination: page=1, next=${token?'2':'n/a'}, prev=n/a`;}

test('managed Jira imports descriptions and all comment pages, retries failures, and preserves identity',async()=>{
 await withEnv(fixture.env,async()=>{for(const engine of fixture.engines){
   const s=await fixture.source(engine,{kind:'jira',jira_jql:'project = EX',jira_mcp_config:'/tmp/mcp.json'});
   const cfg={dir:s.dir,jql:'project = EX',mcpConfig:'/tmp/mcp.json',mcpServer:'jira',project:undefined};
   let fail=true;const calls:Array<{name:string;args:Record<string,unknown>}>=[];
   const client:McpSourceConnection={identity:'https://mcp.example.com#jira',close:async()=>{},call:async(name,args)=>{
     calls.push({name,args});
     if(name==='jira-search')return text(search(args.nextPageToken?['EX-2']:['EX-1'],args.nextPageToken?undefined:'second'));
     const key=String(args.issueKeyOrId);
     if(name==='jira-read-issue'){
       if(key==='EX-2'&&fail)throw new Error('fixture failure');
       return text(`# ${key}: Example\n- **URL:** ${site}/browse/${key}\n\n## Description\nBody for ${key}`);
     }
     const page=Number(args.page);
     return text(`# Jira Issue Comments\n\n- **Issue:** ${key}\n- **Site:** ${site}\n- **Total:** 2\n\n## ${page}) Comment ${page}\nComment ${page}\n\nPagination: page=${page}, next=${page===1?'2':'n/a'}, prev=${page===1?'n/a':'1'}`);
   }};
   const deps={connect:async()=>client,sleep:async()=>{}};
   const first=await runJiraSync(engine,s.id,cfg,options,deps);
   expect(first.status).toBe('partial');expect(first.failedFiles).toBe(1);
   const page=await engine.getPage('jira/ex-1',{sourceId:s.id});
   expect(page?.compiled_truth).toContain('Body for EX-1');expect(page?.compiled_truth).toContain('Comment 2');
   expect(await engine.getPage('jira/ex-2',{sourceId:s.id})).toBeNull();
   fail=false;
   const second=await runJiraSync(engine,s.id,cfg,options,deps);
   expect(second.status).toBe('synced');expect(await engine.getPage('jira/ex-2',{sourceId:s.id})).not.toBeNull();
   expect(calls.some(c=>c.args.nextPageToken==='second')).toBe(true);
   const again=await runJiraSync(engine,s.id,cfg,options,deps);
   expect(again.added+again.modified).toBe(0);
   const other=await fixture.source(engine,{kind:'jira',jira_jql:'project = EX',jira_mcp_config:'/tmp/mcp.json'});
   expect(await engine.getPage('jira/ex-1',{sourceId:other.id})).toBeNull();
   const changedClient={...client,call:async()=>text(search(['EX-1']).replaceAll(site,'https://other.example.com'))};
   await expect(runJiraSync(engine,s.id,cfg,options,{...deps,connect:async()=>changedClient})).rejects.toMatchObject({code:'connector_account_changed'});
 }});
},120000);

test('failed search continuation resumes at the same opaque token',async()=>{
 await withEnv(fixture.env,async()=>{for(const engine of fixture.engines){
   const s=await fixture.source(engine,{kind:'jira',jira_jql:'project = EX',jira_mcp_config:'/tmp/mcp.json'});
   const cfg={dir:s.dir,jql:'project = EX',mcpConfig:'/tmp/mcp.json',mcpServer:'jira'};
   let fail=true;const tokens:unknown[]=[];
   const client:McpSourceConnection={identity:'https://mcp.example.com#jira',close:async()=>{},call:async(name,args)=>{
     if(name==='jira-search'){
       tokens.push(args.nextPageToken);
       if(args.nextPageToken&&fail)throw new Error('fixture interrupted continuation');
       return text(search(args.nextPageToken?['EX-2']:['EX-1'],args.nextPageToken?undefined:'resume-token'));
     }
     const key=String(args.issueKeyOrId);
     if(name==='jira-read-issue')return text(`# ${key}: Example\n- **URL:** ${site}/browse/${key}\n\nBody`);
     return text(`# Jira Issue Comments\n\n- **Issue:** ${key}\n- **Site:** ${site}\n- **Total:** 0\n\n_No comments found._\n\nPagination: page=1, next=n/a, prev=n/a`);
   }};
   const deps={connect:async()=>client,sleep:async()=>{}};
   await expect(runJiraSync(engine,s.id,cfg,options,deps)).rejects.toThrow(/continuation/);
   expect(await engine.getPage('jira/ex-1',{sourceId:s.id})).not.toBeNull();
   fail=false;tokens.length=0;
   const resumed=await runJiraSync(engine,s.id,cfg,options,deps);
   expect(resumed.status).toBe('synced');expect(tokens).toContain('resume-token');
   expect(await engine.getPage('jira/ex-2',{sourceId:s.id})).not.toBeNull();
 }});
},120000);
