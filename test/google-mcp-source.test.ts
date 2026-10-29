import {test,expect} from 'bun:test';
import {parseGoogleMcpSourceConfig} from '../src/core/google-mcp/source-config.ts';
import {parseGmailSearch,parseGmailMessage,parseCalendarPage} from '../src/core/google-mcp/mcp.ts';
import {parseSourceLifecycleArgs} from '../src/commands/sources-lifecycle-args.ts';
test('Google MCP registration is separate and requires an explicit query/mailbox',()=>{
 expect(()=>parseGoogleMcpSourceConfig({},'/tmp/mail')).toThrow(/gmail-query/);
 const p=parseSourceLifecycleArgs(['add','mail','--kind','google-mcp','--account','owner@example.com','--gmail-query','after:2026/01/01','--mcp-config','/tmp/mcp.json']);
 expect((p.params.options as any).googleMcp).toMatchObject({query:'after:2026/01/01',account:'owner@example.com',mcpServer:'google'});
 expect((p.params.options as any).google).toBeUndefined();
});
test('Calendar requires a bounded explicit selection and validates result count',()=>{
 expect(()=>parseGoogleMcpSourceConfig({gm_account:'owner@example.com',gm_calendar_id:'primary',gm_mcp_config:'/tmp/mcp.json'},'/tmp/cal')).toThrow(/time-min/);
 const p=parseSourceLifecycleArgs(['add','cal','--kind','google-mcp','--account','owner@example.com','--calendar-id','primary','--time-min','2026-10-01T00:00:00Z','--time-max','2026-10-11T00:00:00Z','--mcp-config','/tmp/mcp.json']);
 expect((p.params.options as any).googleMcp.calendarId).toBe('primary');
 const t='# Google Calendar Events\n\n**Calendar:** primary\n**Time Zone:** UTC\n**Returned:** 1\n**Next Page Token:** none\n\n1. **Example** — 2026-10-01\n   id: example';
 expect(parseCalendarPage(t,'primary')).toEqual({count:1,next:undefined});
 expect(()=>parseCalendarPage(t,'different')).toThrow();
});
test('Gmail search validates IDs and pagination',()=>{
 const t='# Gmail Messages\n\n**Returned:** 1\n**Next Page Token:** opaque\n\n1. **Example**\n   message id: abc123 — thread id: def456\n';
 expect(parseGmailSearch(t)).toEqual({ids:['abc123'],next:'opaque'});
 expect(()=>parseGmailSearch(t.replace('Returned:** 1','Returned:** 2'))).toThrow(/count/);
});
test('Gmail message body completeness is explicit',()=>{
 const t='# Gmail Message\n\n**Message ID:** abc123\n**Thread ID:** def456\n**Subject:** Example\n\n## Body\n\n**Truncated:** yes\n\nbody';
 expect(parseGmailMessage(t,'abc123')).toMatchObject({threadId:'def456',truncated:true,subject:'Example'});
 expect(()=>parseGmailMessage(t,'ffff')).toThrow(/different/);
 expect(()=>parseGmailMessage(t.replace('**Truncated:** yes',''),'abc123')).toThrow(/truncation/);
});
