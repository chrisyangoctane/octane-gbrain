import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readSlackMcpConfig} from '../src/core/slack/mcp.ts';

test('Slack MCP accepts vendor-neutral server layouts and custom names',()=>{
  const dir=mkdtempSync(join(tmpdir(),'mcp-config-'));
  const path=join(dir,'connection.json');
  try{
    for(const root of ['mcpServers','mcp']){
      writeFileSync(path,JSON.stringify({[root]:{'company-chat':{url:'https://mcp.example.com/slack',headers:{Authorization:'Bearer example-only'}}}}),{mode:0o600});
      const config=readSlackMcpConfig({mcpConfig:path,mcpServer:'company-chat'});
      expect(config.url.href).toBe('https://mcp.example.com/slack');
      expect(config.headers.Authorization).toBe('Bearer example-only');
    }
    writeFileSync(path,JSON.stringify({mcpServers:{'company-chat':{command:'some-local-client',url:'https://mcp.example.com/slack'}}}));
    expect(()=>readSlackMcpConfig({mcpConfig:path,mcpServer:'company-chat'})).toThrow(/configuration/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
