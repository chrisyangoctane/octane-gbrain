import {test,expect} from 'bun:test';
import express,{type Request,type Response,type NextFunction} from 'express';
import {mountAdminSlack} from '../src/commands/serve-http-slack.ts';
import type {ServeHttpContext} from '../src/commands/serve-http.ts';
test('MCP verification requires owner auth and same origin',async()=>{
 const app=express();mountAdminSlack(app,{requireAdmin:(req:Request,res:Response,next:NextFunction)=>{if(req.headers['x-owner']==='yes')next();else res.sendStatus(401);},engine:{executeRaw:async()=>[]}}as unknown as ServeHttpContext);
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',()=>r()));const url=`http://127.0.0.1:${(server.address()as{port:number}).port}`;
 try{expect((await fetch(url+'/admin/api/connections/slack')).status).toBe(401);expect((await fetch(url+'/admin/api/connections/slack/check',{method:'POST',headers:{'x-owner':'yes',origin:'https://attacker.example'}})).status).toBe(403);}finally{server.close();}
});
