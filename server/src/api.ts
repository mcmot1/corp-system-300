import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, ForbiddenException, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { Auth, Public, digest, hashPassword, verifyPassword } from './auth';
import { Policy } from './policy';
import { Realtime } from './realtime';
import { parse, uuid, text, id, page, taskFields } from './validation';
const userInput=z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),display_name:text(120),password:z.string().min(12).max(128),role:z.enum(['admin','employee']).default('employee')}).strict();
@Controller()
export class Api {
 constructor(private db:Db,private auth:Auth,private policy:Policy,private rt:Realtime) {}
 @Public() @Get('health') async health() {await this.db.query('SELECT 1');return {ok:true};}
 @Public() @Post('auth/login') async login(@Body() input:unknown) {
  const b=parse(z.object({email:z.string().email().max(254).transform(s=>s.toLowerCase()),password:z.string().min(1).max(128)}).strict(),input);
  const [u]=await this.db.query('SELECT * FROM users WHERE email=$1',[b.email]);
  // Same scrypt cost for unknown addresses.
  const valid=await verifyPassword(b.password,u?.password_hash??'00000000000000000000000000000000:'+ '00'.repeat(64));
  if(!u?.active||!valid) throw new UnauthorizedException('Неверные учётные данные');
  return this.auth.issue(u.id);
 }
 @Post('auth/logout') async logout(@Req() r:any) {await this.db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(r.token)]);this.rt.disconnect(r.user.id);return {ok:true};}
 @Get('auth/me') me(@Req() r:any) {return r.user;}
 @Post('auth/password') async password(@Req() r:any,@Body() input:unknown) {
  const b=parse(z.object({old_password:z.string().min(1).max(128),new_password:z.string().min(12).max(128)}).strict(),input);
  const [u]=await this.db.query('SELECT password_hash FROM users WHERE id=$1',[r.user.id]);
  if(!await verifyPassword(b.old_password,u.password_hash)) throw new UnauthorizedException();
  const hash=await hashPassword(b.new_password);
  await this.db.tx(async c=>{await c.query('UPDATE users SET password_hash=$1 WHERE id=$2',[hash,r.user.id]);await c.query('DELETE FROM sessions WHERE user_id=$1',[r.user.id]);});
  this.rt.disconnect(r.user.id);return {ok:true,login_required:true};
 }
 @Get('users') async users(@Query() query:unknown) {const p=parse(page,query);return this.db.query('SELECT id,email,display_name,role,active FROM users ORDER BY display_name,id LIMIT $1 OFFSET $2',[p.limit,p.offset]);}
 @Post('users') async createUser(@Req() r:any,@Body() input:unknown) {
  if(r.user.role!=='admin') throw new ForbiddenException();const b=parse(userInput,input);
  const [u]=await this.db.query('INSERT INTO users(email,display_name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,email,display_name,role',[b.email,b.display_name,await hashPassword(b.password),b.role]);return u;
 }
 @Patch('users/:id/active') async activate(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {
  if(r.user.role!=='admin') throw new ForbiddenException();const uid=id(raw);const b=parse(z.object({active:z.boolean()}).strict(),input);
  if(uid===r.user.id) throw new BadRequestException('Нельзя отключить себя');
  const result=await this.db.tx(async c=>{const res=await c.query('UPDATE users SET active=$1 WHERE id=$2 RETURNING id,active',[b.active,uid]);if(!b.active)await c.query('DELETE FROM sessions WHERE user_id=$1',[uid]);return res.rows[0]??null;});
  if(!b.active)this.rt.disconnect(uid);return result;
 }
 @Get('projects') async projects(@Req() r:any,@Query() query:unknown) {const p=parse(page,query);return this.db.query('SELECT p.*,m.role AS my_role FROM projects p JOIN project_members m ON m.project_id=p.id WHERE m.user_id=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT $2 OFFSET $3',[r.user.id,p.limit,p.offset]);}
 @Post('projects') async createProject(@Req() r:any,@Body() input:unknown) {
  const b=parse(z.object({name:text(200),description:z.string().max(20000).default('')}).strict(),input);
  return this.db.tx(async c=>{const {rows:[p]}=await c.query('INSERT INTO projects(name,description,owner_id) VALUES($1,$2,$3) RETURNING *',[b.name,b.description,r.user.id]);await c.query("INSERT INTO project_members VALUES($1,$2,'manager')",[p.id,r.user.id]);return p;});
 }
 @Get('projects/:id/members') async members(@Req() r:any,@Param('id') raw:string) {const pid=id(raw);await this.policy.project(pid,r.user.id);return this.db.query('SELECT u.id,u.display_name,u.active,m.role FROM project_members m JOIN users u ON u.id=m.user_id WHERE m.project_id=$1 ORDER BY u.display_name',[pid]);}
 @Post('projects/:id/members') async addMember(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {
  const pid=id(raw);await this.policy.project(pid,r.user.id,true);
  const b=parse(z.object({user_id:uuid,role:z.enum(['member','manager']).default('member')}).strict(),input);
  return this.db.tx(async c=>{
   const {rows:[p]}=await c.query('SELECT owner_id FROM projects WHERE id=$1 FOR UPDATE',[pid]);
   if(b.user_id===p.owner_id && b.role!=='manager') throw new BadRequestException('Владелец остаётся руководителем');
   const {rows:[u]}=await c.query('SELECT id FROM users WHERE id=$1 AND active',[b.user_id]);if(!u)throw new BadRequestException('Сотрудник неактивен или отсутствует');
   await c.query('INSERT INTO project_members VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role',[pid,b.user_id,b.role]);return {ok:true};
  });
 }
 @Delete('projects/:id/members/:user') async removeMember(@Req() r:any,@Param('id') raw:string,@Param('user') rawUser:string) {
  const pid=id(raw),uid=id(rawUser);await this.policy.project(pid,r.user.id,true);
  return this.db.tx(async c=>{
   const {rows:[p]}=await c.query('SELECT owner_id FROM projects WHERE id=$1 FOR UPDATE',[pid]);
   if(uid===p.owner_id)throw new BadRequestException('Нельзя удалить владельца');
   await c.query('UPDATE tasks SET assignee_id=NULL,version=version+1,updated_at=now() WHERE project_id=$1 AND assignee_id=$2',[pid,uid]);
   await c.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[pid,uid]);return {ok:true};
  });
 }
 @Get('projects/:id/tasks') async tasks(@Req() r:any,@Param('id') raw:string,@Query() query:unknown) {
  const pid=id(raw);await this.policy.project(pid,r.user.id);
  const p=parse(page.extend({status:taskFields.status.optional(),assignee_id:uuid.optional()}),query);
  return this.db.query('SELECT * FROM tasks WHERE project_id=$1 AND ($2::text IS NULL OR status=$2) AND ($3::uuid IS NULL OR assignee_id=$3) ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5',[pid,p.status??null,p.assignee_id??null,p.limit,p.offset]);
 }
 @Post('projects/:id/tasks') async createTask(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {
  const pid=id(raw);await this.policy.project(pid,r.user.id);
  const b=parse(z.object({...taskFields,description:taskFields.description.default(''),status:taskFields.status.default('todo'),priority:taskFields.priority.default('normal'),assignee_id:taskFields.assignee_id.default(null),due_at:taskFields.due_at.default(null)}).strict(),input);
  return this.db.tx(async c=>{const {rows:[t]}=await c.query('INSERT INTO tasks(project_id,title,description,status,priority,creator_id,assignee_id,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[pid,b.title,b.description,b.status,b.priority,r.user.id,b.assignee_id,b.due_at]);await c.query("INSERT INTO task_events(task_id,actor_id,action,data) VALUES($1,$2,'created',$3)",[t.id,r.user.id,JSON.stringify(t)]);return t;});
 }
 @Get('tasks/:id') async task(@Req() r:any,@Param('id') raw:string) {return this.policy.task(id(raw),r.user.id);}
 @Patch('tasks/:id') async updateTask(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {
  const tid=id(raw);await this.policy.task(tid,r.user.id);
  const b=parse(z.object(taskFields).partial().extend({version:z.number().int().positive()}).strict(),input);
  const {version,...fields}=b;const entries=Object.entries(fields);if(!entries.length)throw new BadRequestException('Нет изменений');
  // Field names are restricted by the strict schema; all values are parameterized.
  return this.db.tx(async c=>{const sql=entries.map(([k],i)=>`${k}=$${i+1}`).join(',');const {rows:[t]}=await c.query(`UPDATE tasks SET ${sql},version=version+1,updated_at=now() WHERE id=$${entries.length+1} AND version=$${entries.length+2} RETURNING *`,[...entries.map(x=>x[1]),tid,version]);if(!t)throw new ConflictException('Задача изменена: перечитайте её');await c.query("INSERT INTO task_events(task_id,actor_id,action,data) VALUES($1,$2,'updated',$3)",[tid,r.user.id,JSON.stringify(fields)]);return t;});
 }
 @Get('tasks/:id/events') async events(@Req() r:any,@Param('id') raw:string,@Query() query:unknown) {const tid=id(raw);await this.policy.task(tid,r.user.id);const p=parse(page,query);return this.db.query('SELECT * FROM task_events WHERE task_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[tid,p.limit,p.offset]);}
 @Get('tasks/:id/comments') async comments(@Req() r:any,@Param('id') raw:string,@Query() query:unknown) {const tid=id(raw);await this.policy.task(tid,r.user.id);const p=parse(page,query);return this.db.query('SELECT * FROM task_comments WHERE task_id=$1 ORDER BY created_at,id LIMIT $2 OFFSET $3',[tid,p.limit,p.offset]);}
 @Post('tasks/:id/comments') async comment(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {const tid=id(raw);await this.policy.task(tid,r.user.id);const b=parse(z.object({body:text(10000)}).strict(),input);return (await this.db.query('INSERT INTO task_comments(task_id,author_id,body) VALUES($1,$2,$3) RETURNING *',[tid,r.user.id,b.body]))[0];}
 @Get('conversations') async chats(@Req() r:any,@Query() query:unknown) {const p=parse(page,query);return this.db.query('SELECT c.* FROM conversations c JOIN conversation_members m ON m.conversation_id=c.id WHERE m.user_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT $2 OFFSET $3',[r.user.id,p.limit,p.offset]);}
 @Post('conversations') async chat(@Req() r:any,@Body() input:unknown) {
  // The organisation can contain more than 100 employees. 100 is only a
  // page-size default elsewhere; it is not a system-wide user limit.
  const maxChatMembers = Number(process.env.MAX_CHAT_MEMBERS ?? 500);
  const b=parse(z.object({name:text(200),kind:z.enum(['direct','group']),member_ids:z.array(uuid).min(1).max(maxChatMembers)}).strict(),input);
  const members=[...new Set([r.user.id,...b.member_ids])];if(b.kind==='direct'&&members.length!==2)throw new BadRequestException('Личный чат: два участника');
  return this.db.tx(async c=>{const {rows}=await c.query('SELECT id FROM users WHERE id=ANY($1::uuid[]) AND active',[members]);if(rows.length!==members.length)throw new BadRequestException('Есть неактивные или неизвестные участники');const {rows:[chat]}=await c.query('INSERT INTO conversations(name,kind,creator_id) VALUES($1,$2,$3) RETURNING *',[b.name,b.kind,r.user.id]);await c.query('INSERT INTO conversation_members SELECT $1,unnest($2::uuid[])',[chat.id,members]);return chat;});
 }
 @Get('conversations/:id/members') async chatMembers(@Req() r:any,@Param('id') raw:string) {const cid=id(raw);await this.policy.chat(cid,r.user.id);return this.db.query('SELECT u.id,u.display_name,u.active FROM users u JOIN conversation_members m ON m.user_id=u.id WHERE m.conversation_id=$1',[cid]);}
 @Get('conversations/:id/messages') async messages(@Req() r:any,@Param('id') raw:string,@Query() query:unknown) {
  const cid=id(raw);await this.policy.chat(cid,r.user.id);
  const p=parse(z.object({limit:z.coerce.number().int().min(1).max(100).default(50),before:z.string().regex(/^[1-9][0-9]{0,17}$/).optional(),after:z.string().regex(/^[0-9]{1,18}$/).optional()}).refine(v=>!(v.before&&v.after),'Используйте before или after'),query);
  return this.db.query(`SELECT * FROM messages WHERE conversation_id=$1 AND ($2::bigint IS NULL OR id<$2) AND ($3::bigint IS NULL OR id>$3) ORDER BY id ${p.after!==undefined?'ASC':'DESC'} LIMIT $4`,[cid,p.before??null,p.after??null,p.limit]);
 }
 @Post('conversations/:id/messages') async send(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {
  const cid=id(raw);await this.policy.chat(cid,r.user.id);const b=parse(z.object({body:text(10000),client_id:uuid}).strict(),input);
  let [m]=await this.db.query('INSERT INTO messages(conversation_id,sender_id,client_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(conversation_id,sender_id,client_id) DO NOTHING RETURNING *',[cid,r.user.id,b.client_id,b.body]);
  if(!m) { [m]=await this.db.query('SELECT * FROM messages WHERE conversation_id=$1 AND sender_id=$2 AND client_id=$3',[cid,r.user.id,b.client_id]);if(m.body!==b.body)throw new ConflictException('client_id уже использован'); }
  // REST response is authoritative. Reconnection recovers missed events from PostgreSQL.
  this.rt.chat(cid,m).catch(e=>console.error('Realtime delivery failed',e.message));return m;
 }
 @Post('conversations/:id/read') async read(@Req() r:any,@Param('id') raw:string,@Body() input:unknown) {
  const cid=id(raw);await this.policy.chat(cid,r.user.id);const b=parse(z.object({message_id:z.string().regex(/^[1-9][0-9]{0,17}$/)}).strict(),input);
  const [m]=await this.db.query('SELECT id FROM messages WHERE conversation_id=$1 AND id=$2',[cid,b.message_id]);if(!m)throw new BadRequestException('Сообщение не из этого чата');
  await this.db.query('INSERT INTO message_reads VALUES($1,$2,$3) ON CONFLICT(conversation_id,user_id) DO UPDATE SET last_message_id=greatest(message_reads.last_message_id,EXCLUDED.last_message_id)',[cid,r.user.id,b.message_id]);return {ok:true};
 }
}
