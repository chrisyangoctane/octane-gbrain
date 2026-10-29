/** Owner-only Slack MCP inspection. No browser-cookie or shell-login bridge. */
import type {Express} from 'express';
import type {ServeHttpContext} from './serve-http.ts';
import {parseSlackSourceConfig} from '../core/slack/source-config.ts';
import {connectSlackMcp} from '../core/slack/mcp.ts';

export function mountAdminSlack(app:Express,ctx:ServeHttpContext):void{
  const {requireAdmin,engine}=ctx;
  const configs=()=>engine.executeRaw<{id:string;local_path:string|null;config:Record<string,unknown>}>("SELECT id,local_path,config FROM sources WHERE NOT archived AND config->>'kind'='slack'");
  app.get('/admin/api/connections/slack',requireAdmin,async(_req,res)=>{
    try{const rows=await configs();res.json({transport:'mcp',sources:rows.map(s=>({id:s.id,channels:String(s.config.slack_channels??'').split(','),server:s.config.slack_mcp_config?(s.config.slack_mcp_server??'slack'):'legacy import (preserved)',legacy:!s.config.slack_mcp_config})),coverage:'Channel history only; thread replies require exact timestamps not exposed by the current MCP server.'});}
    catch{res.status(500).json({error:'Unable to read Slack MCP connection status'});}
  });
  app.post('/admin/api/connections/slack/check',requireAdmin,async(req,res)=>{
    try{const origin=new URL(req.headers.origin??'');if(origin.host!==req.headers.host)throw new Error();}
    catch{res.status(403).json({error:'A same-origin admin request is required'});return;}
    try{
      const rows=await configs();const source=rows.find(s=>s.id===req.body?.source_id);
      if(!source){res.status(404).json({error:'Choose a registered Slack source'});return;}
      const client=await connectSlackMcp(parseSlackSourceConfig(source.config,source.local_path??''));
      await client.close();res.json({connected:true,message:'MCP handshake and history tool verified. No Slack history was fetched.'});
    }catch{res.status(409).json({error:'Could not verify Slack MCP. Complete authentication in your configured MCP client, then retry.'});}
  });
}
