/** Shared read-only MCP connection for ingestion sources. Auth is configured externally. */
import {readFileSync} from 'node:fs';
import {parse,type ParseError} from 'jsonc-parser';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export interface McpSourceConfig {mcpConfig:string;mcpServer:string}
export interface McpSourceResult {content?:Array<{type:string;text?:string}>;structuredContent?:Record<string,unknown>;isError?:boolean}
export interface McpSourceConnection {
  identity:string;
  call(name:string,args:Record<string,unknown>,signal?:AbortSignal):Promise<McpSourceResult>;
  close():Promise<void>;
}

export function readMcpSourceConfig(cfg:McpSourceConfig):{url:URL;headers:Record<string,string>}{
  try{
    const errors:ParseError[]=[];
    const root=parse(readFileSync(cfg.mcpConfig,'utf8'),errors);
    const server=root?.mcpServers?.[cfg.mcpServer]??root?.mcp?.[cfg.mcpServer];
    if(errors.length||!server||server.enabled===false||server.command||server.type!==undefined&&!['remote','http','streamable-http'].includes(server.type))throw new Error();
    const url=new URL(server.url);
    if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error();
    const headers:Record<string,string>={};
    for(const [name,value]of Object.entries(server.headers??{})){
      if(typeof value!=='string')throw new Error();
      headers[name]=value.replace(/\{env:([A-Z_][A-Z0-9_]*)\}/g,(_,key)=>{const v=process.env[key];if(!v)throw new Error();return v;});
    }
    return {url,headers};
  }catch{throw new Error('MCP configuration is unavailable or invalid. Supply an enabled remote server in --mcp-config.');}
}

export async function connectMcpSource(cfg:McpSourceConfig,requiredTools:readonly string[]):Promise<McpSourceConnection>{
  const {url,headers}=readMcpSourceConfig(cfg);
  const client=new Client({name:'gbrain-ingest',version:'1'});
  try{
    await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers,redirect:'error'}}),{timeout:30000});
    const names=new Set<string>();let cursor:string|undefined;
    const seen=new Set<string>();
    do{
      const page=await client.listTools(cursor?{cursor}:undefined);
      page.tools.forEach(t=>names.add(t.name));cursor=page.nextCursor;
      if(cursor&&seen.has(cursor))throw new Error();
      if(cursor)seen.add(cursor);
    }while(cursor);
    if(requiredTools.some(name=>!names.has(name)))throw new Error();
  }catch{await client.close().catch(()=>{});throw new Error('Cannot connect to MCP or required ingestion tools are unavailable. Check the existing MCP connection through the server portal.');}
  return {identity:url.toString()+'#'+cfg.mcpServer,
    async call(name,args,signal){
      if(!requiredTools.includes(name))throw new Error('MCP tool is not permitted for this ingestion source.');
      try{return await client.callTool({name,arguments:args},undefined,{signal,timeout:60000})as McpSourceResult;}
      catch{throw new Error('MCP read request failed. Check server authentication or rate limits before retrying.');}
    },close:()=>client.close()};
}
