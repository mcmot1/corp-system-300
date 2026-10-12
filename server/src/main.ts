import 'reflect-metadata';
import { NestFactory, APP_GUARD } from '@nestjs/core';
import { Module, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { json } from 'express';
import { Db } from './db';
import { Auth, AuthGuard } from './auth';
import { Policy } from './policy';
import { Realtime } from './realtime';
import { Api } from './api';
@Catch()
class Errors implements ExceptionFilter {
 catch(e:any,host:ArgumentsHost) {
  const res=host.switchToHttp().getResponse();
  if(e instanceof HttpException) {res.status(e.getStatus()).json(e.getResponse());return;}
  const status=e.code==='23505'?409:['23503','23514','22P02','22003','22007','22008'].includes(e.code)?400:500;
  if(status===500)console.error('Request failed',e.stack);
  res.status(status).json({statusCode:status,message:status===500?'Ошибка сервера':status===409?'Запись уже существует':'Недопустимые данные или связи'});
 }
}
@Module({controllers:[Api],providers:[Db,Auth,Policy,Realtime,{provide:APP_GUARD,useClass:AuthGuard}]})
class AppModule {}
async function main() {
 if(!process.env.DATABASE_URL||!process.env.CORS_ORIGINS)throw new Error('DATABASE_URL and CORS_ORIGINS required');
 const maxChatMembers=Number(process.env.MAX_CHAT_MEMBERS ?? 500);
 if(!Number.isInteger(maxChatMembers)||maxChatMembers<2||maxChatMembers>5000)throw new Error('MAX_CHAT_MEMBERS must be an integer from 2 to 5000');
 const origins=process.env.CORS_ORIGINS.split(',').map(s=>s.trim());
 const app=await NestFactory.create(AppModule,{bodyParser:false});
 // Exactly one reverse proxy (Caddy) in compose; API port is not published.
 app.getHttpAdapter().getInstance().set('trust proxy',1);
 app.use(helmet());app.use(json({limit:'64kb'}));
 app.enableCors({origin:origins});
 app.use('/api/auth/login',rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}));
 app.use('/api',rateLimit({windowMs:60*1000,limit:600,standardHeaders:'draft-8',legacyHeaders:false}));
 app.setGlobalPrefix('api');app.useGlobalFilters(new Errors());app.enableShutdownHooks();
 await app.get(Db).query('SELECT version FROM schema_migrations WHERE version=1');
 app.get(Realtime).attach(app.getHttpServer(),origins);
 await app.listen(3000,'0.0.0.0');
}
main().catch(e=>{console.error(e);process.exit(1);});
