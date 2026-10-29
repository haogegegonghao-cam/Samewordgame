import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
export const A='11111111-1111-4111-8111-111111111111';
export const B='22222222-2222-4222-8222-222222222222';
export const C='33333333-3333-4333-8333-333333333333';
export async function makeDatabase() {
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema public,auth to anon,authenticated;
    grant execute on function auth.uid() to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/schema.sql',import.meta.url),'utf8'));
  let queue=Promise.resolve();
  const as=(uid,sql,args=[])=>{
    const operation=queue.then(()=>db.transaction(async tx=>{
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid||'']);
      await tx.exec('set local role authenticated');
      return (await tx.query(sql,args)).rows;
    }));
    queue=operation.catch(()=>{});return operation;
  };
  const rpc=async(uid,action,args=[])=>{
    const types={create:[],join:['text'],sync:['uuid'],submit:['uuid','integer','integer','text'],advance:['uuid','integer','integer'],restart:['uuid','integer'],leave:['uuid']}[action];
    return (await as(uid,`select public.game_${action}(${types.map((t,i)=>`$${i+1}::${t}`).join(',')}) as result`,args))[0].result;
  };
  return {db,as,rpc,close:()=>db.close()};
}
