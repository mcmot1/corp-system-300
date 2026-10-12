import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Db } from './db';
@Injectable()
export class Policy {
 constructor(private db:Db) {}
 async project(project:string,user:string,manage=false) {
  const [m]=await this.db.query('SELECT role FROM project_members WHERE project_id=$1 AND user_id=$2',[project,user]);
  if(!m || (manage && m.role!=='manager')) throw new ForbiddenException('Нет доступа к проекту');
 }
 async task(task:string,user:string) {
  const [t]=await this.db.query('SELECT * FROM tasks WHERE id=$1',[task]);
  if(!t) throw new NotFoundException(); await this.project(t.project_id,user); return t;
 }
 async chat(chat:string,user:string) {
  const [m]=await this.db.query('SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2',[chat,user]);
  if(!m) throw new ForbiddenException('Нет доступа к переписке');
 }
}
