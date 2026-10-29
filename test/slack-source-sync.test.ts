import {test,expect} from 'bun:test';
import {parseSlackSourceConfig,slackChannelId} from '../src/core/slack/source-config.ts';
import {parseSlackHistory} from '../src/core/slack/mcp.ts';
import {parseSourceLifecycleArgs} from '../src/commands/sources-lifecycle-args.ts';
test('Slack source resolves URLs and references MCP configuration, never credentials',()=>{
 expect(slackChannelId('https://example.slack.com/archives/C12345678')).toBe('C12345678');
 expect(()=>slackChannelId('../secret')).toThrow();
 expect(()=>parseSlackSourceConfig({slack_channels:'C12345678'},'/tmp/slack')).toThrow(/--mcp-config/);
 expect(parseSlackSourceConfig({slack_channels:'C12345678',slack_mcp_config:'/tmp/mcp.json'},'/tmp/slack').mcpServer).toBe('slack');
 const p=parseSourceLifecycleArgs(['add','slack','--kind','slack','--channels','C12345678','--mcp-config','/tmp/mcp.json','--mcp-server','slack']);
 expect(JSON.stringify(p)).toContain('mcpServer');expect(JSON.stringify(p)).not.toContain('slackdump');
});
test('history metadata is parsed without inventing exact timestamps',()=>{
 const p=parseSlackHistory({content:[{type:'text',text:'**Messages** (showing 2)\n**Next Cursor**: abc\n**Thread Replies**: 3'}]});
 expect(p).toMatchObject({count:2,threads:1,cursor:'abc'});
 expect(()=>parseSlackHistory({isError:true,content:[]})).toThrow();
 expect(()=>parseSlackHistory({content:[{type:'text',text:'unexpected'}]})).toThrow();
 expect(()=>parseSlackHistory({content:[{type:'text',text:'429 rate_limited Retry-After 60'}]})).toThrow(/rate limiting/);
});
