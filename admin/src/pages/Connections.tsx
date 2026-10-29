import React,{useEffect,useState} from 'react';
import {api} from '../api';
interface Connection{sources:Array<{id:string;channels:string[];server:string}>;coverage:string}
export function ConnectionsPage(){
  const [data,setData]=useState<Connection|null>(null);
  const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  async function refresh(){try{setData(await api.slackConnection());setError('');}catch(e){setError(e instanceof Error?e.message:'Unable to read connections');}}
  useEffect(()=>{void refresh();},[]);
  async function check(id:string){setBusy(true);setNotice('');try{const r=await api.slackCheck(id);setNotice(r.message);setError('');}catch(e){setError(e instanceof Error?e.message:'MCP connection failed');}finally{setBusy(false);}}
  return <div className="connections-page"><h1>Connections</h1><p className="connection-muted">Read from your existing authenticated MCP connections.</p>
    {error&&<div className="connection-message" role="alert">{error}</div>}
    <section className="connection-card"><header className="connection-header"><h2>Slack MCP</h2><span className="connection-status">External authentication</span></header>
      <p>gbrain uses the Slack server configured in your MCP client. Complete that server's authentication in Kilo, then verify the connection here. No Slackdump, Terminal wizard or additional Slack app is needed.</p>
      <p className="connection-muted">Verification checks the MCP handshake and available tools, not channel history. Credentials stay in your client configuration and are never displayed here.</p>
      <div className="connection-message">{data?.coverage??'Loading connection status...'}</div>
      {notice&&<div className="connection-message" role="status">{notice}</div>}
      <button className="btn" onClick={()=>void refresh()}>Refresh Status</button>
      <h3>Slack Sources</h3>
      {data?.sources.length?<div className="connection-table"><table><thead><tr><th>Source</th><th>MCP Server</th><th>Channels</th><th>Connection</th></tr></thead><tbody>{data.sources.map(s=><tr key={s.id}><td><code>{s.id}</code></td><td>{s.server}</td><td>{s.channels.join(', ')}</td><td><button className="btn" disabled={busy} onClick={()=>void check(s.id)}>{busy?'Checking...':'Verify MCP'}</button></td></tr>)}</tbody></table></div>:<p>No sources registered. Use <code>gbrain sources add slack --kind slack --channels C12345678 --mcp-server slack</code>.</p>}
      <p className="connection-muted">Sync is explicit. Existing legacy Slack imports are preserved; MCP snapshots use a separate namespace and report missing thread coverage.</p>
    </section></div>;
}
