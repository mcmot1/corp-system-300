import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export const uuid=z.string().uuid();
export const text=(max:number)=>z.string().trim().min(1).max(max);
export function parse<T>(schema:z.ZodType<T>,value:unknown):T {
 const r=schema.safeParse(value); if(!r.success) throw new BadRequestException(r.error.flatten()); return r.data;
}
export const id=(value:unknown)=>parse(uuid,value);
export const page=z.object({limit:z.coerce.number().int().min(1).max(100).default(50),offset:z.coerce.number().int().min(0).max(100000).default(0)});
export const taskFields={title:text(250),description:z.string().max(20000),status:z.enum(['todo','in_progress','review','done','cancelled']),priority:z.enum(['low','normal','high','urgent']),assignee_id:uuid.nullable(),due_at:z.string().datetime({offset:true}).nullable()};
