import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { Db } from './db';
const scrypt=promisify(scryptCb);
export const Public=()=>SetMetadata('public',true);
export const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
export async function hashPassword(password:string) {
 const salt=randomBytes(16).toString('hex');
 const key=await scrypt(password,salt,64) as Buffer;
 return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password:string,hash:string) {
 const [salt,key]=hash.split(':'); const actual=await scrypt(password,salt,64) as Buffer;
 const expected=Buffer.from(key,'hex'); return actual.length===expected.length && timingSafeEqual(actual,expected);
}
@Injectable()
export class Auth {
 constructor(private db:Db) {}
 async user(token:unknown) {
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)) throw new UnauthorizedException();
  const [u]=await this.db.query(`SELECT u.id,u.email,u.display_name,u.role,s.expires_at FROM sessions s
   JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`,[digest(token)]);
  if(!u) throw new UnauthorizedException(); return u;
 }
 async issue(userId:string) {
  const token=randomBytes(32).toString('hex');
  const [s]=await this.db.query(`INSERT INTO sessions(token_hash,user_id,expires_at)
   VALUES($1,$2,now()+interval '8 hours') RETURNING expires_at`,[digest(token),userId]);
  return {access_token:token,token_type:'Bearer',expires_at:s.expires_at};
 }
}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(private auth:Auth,private reflector:Reflector) {}
 async canActivate(ctx:ExecutionContext) {
  if(this.reflector.getAllAndOverride('public',[ctx.getHandler(),ctx.getClass()])) return true;
  const r=ctx.switchToHttp().getRequest();
  r.token=r.headers.authorization?.replace(/^Bearer /,''); r.user=await this.auth.user(r.token); return true;
 }
}
