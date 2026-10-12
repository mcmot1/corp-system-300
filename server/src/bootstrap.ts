import { Pool } from 'pg';
import { hashPassword } from './auth';
async function main() {
 const email=process.env.ADMIN_EMAIL?.toLowerCase(),password=process.env.ADMIN_PASSWORD;
 if(!email||!/^\S+@\S+\.\S+$/.test(email)||!password||password.length<12||password.length>128)throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD (12–128 chars) required');
 const pool=new Pool({connectionString:process.env.DATABASE_URL});
 try {
  await pool.query("INSERT INTO users(email,display_name,password_hash,role) VALUES($1,$2,$3,'admin') ON CONFLICT(email) DO NOTHING",[email,process.env.ADMIN_NAME||'Администратор',await hashPassword(password)]);
  console.log('Bootstrap complete. Existing accounts are not modified.');
 } finally {await pool.end();}
}
main().catch(e=>{console.error(e.message);process.exit(1);});
