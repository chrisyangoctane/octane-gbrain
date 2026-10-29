import {beforeAll,afterAll,test,expect} from 'bun:test';
import {createConnectorFixture,options} from './helpers/connector-fixture.ts';
import {withEnv} from './helpers/with-env.ts';
import {runConfluenceSync} from '../src/core/confluence/sync.ts';
import type {McpSourceConnection} from '../src/core/mcp-source.ts';

const f=createConnectorFixture();beforeAll(f.setup,120000);afterAll(f.teardown);
const text=(s:string)=>({content:[{type:'text',text:s}]});
const searchPage=(ids:string[],cursor?:string)=>`# Confluence Search Results\n**Query:** *\n**Results Per Page:** 50\n**Returned:** ${ids.length}\n**Has More:** ${cursor?'Yes':'No'}${cursor?`\n**Next Cursor:** ${cursor}`:''}\n\n${ids.map((id,i)=>`${i+1}. Page ${id}\n   - Space: DOC\n   - Page ID: ${id}\n   - Type: page\n   - URL: https://example.atlassian.net/wiki/spaces/DOC/pages/${id}/Page`).join('\n')}`;

test('managed Confluence paginates by cursor, retries failed pages and isolates spaces',async()=>{
  await withEnv(f.env,async()=>{for(const engine of f.engines){
    const raw={kind:'confluence',confluence_space:'DOC',confluence_mcp_config:'/tmp/mcp.json'};
    const source=await f.source(engine,raw);
    const cfg={dir:source.dir,space:'DOC',mcpConfig:'/tmp/mcp.json',mcpServer:'confluence'};
    let failPage=true;const cursors:unknown[]=[];
    const client:McpSourceConnection={identity:'https://mcp.example.com/confluence#confluence',close:async()=>{},call:async(name,args)=>{
      if(name==='confluence-search'){cursors.push(args.cursor);return text(args.cursor==='next-1'?searchPage(['222']):searchPage(['111'],'next-1'));}
      const url=String(args.pageUrl);const id=url.match(/pages\/(\d+)/)![1]!;
      if(id==='222'&&failPage)throw new Error('fixture outage');
      return text(`Title: Page ${id}\nVersion: 2\n\n# Page ${id}\nBody ${id}`);
    }};
    const deps={connect:async()=>client,sleep:async()=>{}};
    const first=await runConfluenceSync(engine,source.id,cfg,options,deps);
    expect(first.status).toBe('partial');expect(first.failedFiles).toBe(1);
    expect((await engine.getPage('confluence/111',{sourceId:source.id}))?.compiled_truth).toContain('Body 111');
    failPage=false;
    // The first sweep is incomplete (page 222 failed), so the next run resumes its saved cursor
    // and retries 222 without re-reading the already-imported page 111.
    const retry=await runConfluenceSync(engine,source.id,cfg,options,deps);
    expect(retry.status).toBe('synced');
    expect(cursors).toContain('next-1');
    expect(cursors.filter(c=>c==='next-1').length).toBeGreaterThanOrEqual(1);
    expect((await engine.getPage('confluence/222',{sourceId:source.id}))).not.toBeNull();
    const again=await runConfluenceSync(engine,source.id,cfg,options,deps);expect(again.added+again.modified).toBe(0);
    const other=await f.source(engine,{...raw,confluence_space:'OTHER'});
    expect(await engine.getPage('confluence/111',{sourceId:other.id})).toBeNull();
    // A changed space is refused by the registered source's options, so it cannot mix pages across spaces.
    await expect(runConfluenceSync(engine,source.id,{...cfg,space:'OTHER'},options,deps)).rejects.toThrow(/do not match the registered source/);
  }});
},120000);
