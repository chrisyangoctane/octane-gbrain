import {test,expect} from 'bun:test';
import {parseConfluenceSourceConfig} from '../src/core/confluence/source-config.ts';
import {parseConfluenceSearch,parseConfluencePage} from '../src/core/confluence/mcp.ts';
import {parseSourceLifecycleArgs} from '../src/commands/sources-lifecycle-args.ts';

test('Confluence requires an explicit space and MCP connection',()=>{
  expect(()=>parseConfluenceSourceConfig({},'/tmp/conf')).toThrow(/--space/);
  expect(()=>parseConfluenceSourceConfig({confluence_space:'docs'},'/tmp/conf')).toThrow(/mcp-config/);
  expect(()=>parseConfluenceSourceConfig({confluence_space:'bad key',confluence_mcp_config:'/tmp/mcp.json'},'/tmp/conf')).toThrow(/space key/);
  const p=parseSourceLifecycleArgs(['add','docs','--kind','confluence','--space','DOC','--mcp-config','/tmp/mcp.json']);
  expect((p.params.options as any).confluence).toMatchObject({space:'DOC',mcpServer:'confluence'});
  expect(()=>parseSourceLifecycleArgs(['add','docs','--kind','jira','--space','DOC','--mcp-config','/tmp/mcp.json'])).toThrow();
});

test('Confluence search exposes page IDs, URLs and opaque cursors',()=>{
  const text='# Confluence Search Results\n**Query:** *\n**Results Per Page:** 2\n**Returned:** 1\n**Has More:** Yes\n**Next Cursor:** opaque-1\n\n1. Example\n   - Space: DOC\n   - Page ID: 123\n   - Type: page\n   - URL: https://example.atlassian.net/wiki/spaces/DOC/pages/123/Example\n   - Excerpt: text';
  const page=parseConfluenceSearch(text);
  expect(page).toMatchObject({ids:['123'],nextCursor:'opaque-1',hasMore:true});
  expect(page.urls.get('123')).toContain('/pages/123/');
  expect(()=>parseConfluenceSearch(text.replace('**Next Cursor:** opaque-1',''))).toThrow(/without a cursor/);
  expect(()=>parseConfluenceSearch(text.replace('**Returned:** 1','**Returned:** 2'))).toThrow(/count/);
});

test('Confluence page reads keep title, version and body without guessing identity',()=>{
  const page=parseConfluencePage('Title: Example\nVersion: 4\nUpdated: 2026-10-01 10:00 ET\n\n# Heading\nBody','987');
  expect(page).toMatchObject({id:'987',title:'Example',version:4,markdown:'# Heading\nBody'});
  expect(()=>parseConfluencePage('nonsense','987')).toThrow();
});
