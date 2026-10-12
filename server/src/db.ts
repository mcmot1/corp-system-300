import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
@Injectable()
export class Db implements OnModuleDestroy {
 readonly pool = new Pool({connectionString: process.env.DATABASE_URL,
  // 20 connections is appropriate for a single VPS serving ~300 active users;
  // override it for a larger deployment without changing code.
  max: Number(process.env.DB_POOL_MAX ?? 20),
  connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000});
 constructor() { this.pool.on('error', e => console.error('PostgreSQL pool error', e.message)); }
 async query(sql: string, values: unknown[] = []) { return (await this.pool.query(sql, values)).rows; }
 async tx<T>(fn: (c: PoolClient)=>Promise<T>): Promise<T> {
  const c = await this.pool.connect();
  try { await c.query('BEGIN'); const value=await fn(c); await c.query('COMMIT'); return value; }
  catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
 }
 async onModuleDestroy() { await this.pool.end(); }
}
