// TEST ONLY: local Supabase-compatible HTTP transport backed by the real schema.
// This is not a production auth service and is never included in dist/.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { makeDatabase } from './database.mjs';
const store=await makeDatabase();
const sessions=new Map();
const users=new Map();
function session(uid) {
  const expires=Math.floor(Date.now()/1000)+3600;
  const payload=Buffer.from(JSON.stringify({sub:uid,aud:'authenticated',role:'authenticated',exp:expires,iat:expires-3600,is_anonymous:true})).toString('base64url');
  const token=`${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${payload}.local-test-signature`;
  const user={id:uid,aud:'authenticated',role:'authenticated',email:'',is_anonymous:true,app_metadata:{provider:'anonymous',providers:['anonymous']},user_metadata:{},identities:[],created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  sessions.set(token,uid);users.set(uid,user);
  return {access_token:token,token_type:'bearer',expires_in:3600,expires_at:expires,refresh_token:uid,user};
}
const api=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');res.setHeader('Access-Control-Allow-Methods','POST,GET,OPTIONS');res.setHeader('Content-Type','application/json');
  if(req.method==='OPTIONS') {res.writeHead(204);res.end();return;}
  try {
    let body='';for await(const chunk of req) body+=chunk;
    const args=body?JSON.parse(body):{};
    const uid=sessions.get(req.headers.authorization?.replace(/^Bearer /,''));
    if(req.url.startsWith('/auth/v1/signup')) {res.end(JSON.stringify(session(randomUUID())));return;}
    if(req.url.startsWith('/auth/v1/token') && users.has(args.refresh_token)) {res.end(JSON.stringify(session(args.refresh_token)));return;}
    if(!uid) {res.writeHead(401);res.end(JSON.stringify({message:'AUTH_REQUIRED'}));return;}
    if(req.url==='/auth/v1/user') {res.end(JSON.stringify(users.get(uid)));return;}
    if(req.url.startsWith('/rest/v1/rpc/game_')) {
      const action=req.url.split('game_')[1].split('?')[0];
      const names={create:[],join:['p_code'],sync:['p_room'],submit:['p_room','p_game','p_round','p_word'],advance:['p_room','p_game','p_round'],restart:['p_room','p_game'],leave:['p_room']}[action];
      if(!names) throw new Error('UNKNOWN_RPC');
      const result=await store.rpc(uid,action,names.map(n=>args[n]));
      res.end(JSON.stringify(result));return;
    }
    if(req.url.startsWith('/rest/v1/game_rooms')) {res.end(JSON.stringify(await store.as(uid,'select * from public.game_rooms')));return;}
    res.writeHead(404);res.end(JSON.stringify({message:'Not found'}));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({message:e.message,code:e.code||'P0001',details:null,hint:null}));}
});
await new Promise(resolve=>api.listen(4174,'127.0.0.1',resolve));
process.env.VITE_SUPABASE_URL='http://127.0.0.1:4174';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY='local-test-publishable-key';
const vite=await createServer({server:{host:'127.0.0.1',port:4173,strictPort:true}});
await vite.listen();
console.log('TEST-ONLY local game: http://127.0.0.1:4173 (PostgreSQL, polling transport; no cloud credentials)');
async function close(){await vite.close();api.close();await store.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
