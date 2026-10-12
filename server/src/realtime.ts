import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { Auth } from './auth';
import { Db } from './db';
@Injectable()
export class Realtime {
 io?:Server;
 constructor(private auth:Auth,private db:Db) {}
 attach(http:any,origins:string[]) {
  this.io=new Server(http,{cors:{origin:origins},maxHttpBufferSize:16384});
  this.io.use(async(s,next)=>{
   try {s.data.user=await this.auth.user(s.handshake.auth.token);s.data.token=s.handshake.auth.token;next();}
   catch {next(new Error('Unauthorized'));}
  });
  this.io.on('connection',s=>{
   s.join(s.data.user.id);
   const timeout=setTimeout(()=>s.disconnect(true),Math.max(0,new Date(s.data.user.expires_at).getTime()-Date.now()));
   s.on('disconnect',()=>clearTimeout(timeout));
  });
 }
 async chat(chat:string,message:unknown) {
  // Resolve authorization on each emission; never allow client-chosen room joins.
  const rows=await this.db.query('SELECT user_id FROM conversation_members WHERE conversation_id=$1',[chat]);
  for(const row of rows) {
   const sockets=await this.io?.in(row.user_id).fetchSockets();
   for(const s of sockets??[]) {
    try {await this.auth.user(s.data.token);s.emit('message.created',message);}
    catch {s.disconnect(true);}
   }
  }
 }
 disconnect(user:string) {this.io?.in(user).disconnectSockets(true);}
}
