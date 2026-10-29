import {test,expect} from 'bun:test';
import {parseJiraSourceConfig} from '../src/core/jira/source-config.ts';
import {parseJiraSearch,parseJiraComments,validateJiraIssue} from '../src/core/jira/mcp.ts';
import {parseSourceLifecycleArgs} from '../src/commands/sources-lifecycle-args.ts';

test('Jira source requires explicit connection and selection, independently of Confluence',()=>{
  expect(()=>parseJiraSourceConfig({},'/tmp/jira')).toThrow(/jql/);
  expect(()=>parseJiraSourceConfig({jira_jql:'project = EX'},'/tmp/jira')).toThrow(/mcp-config/);
  const parsed=parseSourceLifecycleArgs(['add','tickets','--kind','jira','--jql','project = EX','--mcp-config','/tmp/mcp.json','--project','EX']);
  expect((parsed.params.options as any).jira).toMatchObject({jql:'project = EX',project:'EX',mcpServer:'jira'});
  expect(()=>parseSourceLifecycleArgs(['add','tickets','--kind','slack','--jql','project = EX','--mcp-config','/tmp/mcp.json'])).toThrow();
});

export function searchResponse(keys:string[],token?:string){
 return `# Jira Search Results\n**JQL:** project = EX\n**Site:** https://jira.example.com\n**Total:** unknown${token?`\n**nextPageToken:** ${token}`:''}\n\n${keys.length?keys.map((k,i)=>`${i+1}. ${k} — Example [Open]\n   https://jira.example.com/browse/${k}`).join('\n'):'No issues found.'}\n\nPagination: page=1, next=${token?'2':'n/a'}, prev=n/a`;
}
test('Jira search uses opaque continuation tokens and exact issue keys',()=>{
 expect(parseJiraSearch(searchResponse(['EX-1'],'opaque-token'))).toEqual({site:'https://jira.example.com',keys:['EX-1'],nextToken:'opaque-token'});
 expect(parseJiraSearch(searchResponse([])).keys).toEqual([]);
 expect(()=>parseJiraSearch(searchResponse(['EX-1'],'x').replace('**nextPageToken:** x',''))).toThrow(/continuation/);
 expect(()=>parseJiraSearch('unexpected')).toThrow();
});
test('Jira issue and comment identities must match selected site/key',()=>{
 validateJiraIssue('# EX-1: Example\n- **URL:** https://jira.example.com/browse/EX-1','EX-1','https://jira.example.com');
 expect(()=>validateJiraIssue('# EX-2: Example','EX-1','https://jira.example.com')).toThrow();
 const comments='# Jira Issue Comments\n\n- **Issue:** EX-1\n- **Site:** https://jira.example.com\n- **Total:** 2\n\n## 1) Comment 10\nExample\n\nPagination: page=1, next=2, prev=n/a';
 expect(parseJiraComments(comments,'EX-1','https://jira.example.com',1).next).toBe(2);
 expect(()=>parseJiraComments(comments.replace('**Total:** 2','**Total:** unknown'),'EX-1','https://jira.example.com',1)).toThrow(/unknown/);
 expect(()=>parseJiraComments(comments,'EX-2','https://jira.example.com',1)).toThrow();
});
