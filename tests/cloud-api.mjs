// Live Supabase smoke test. Uses ONLY a publishable key and real anonymous users.
// Run after enabling Anonymous Sign-Ins. Tests create disposable closed rooms.
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const config=JSON.parse(await readFile(new URL('../src/public-config.json',import.meta.url),'utf8'));
const url=process.env.VITE_SUPABASE_URL||config.url;
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||config.publishableKey;
const clients=Array.from({length:3},()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}));
const [a,b,c]=clients;
const call=async(client,name,args={})=>{const r=await client.rpc(`game_${name}`,args).abortSignal(AbortSignal.timeout(12000));if(r.error)throw r.error;return r.data;};
let room,channels=[];
try{
  for(const client of clients){const {error}=await client.auth.signInAnonymously();if(error)throw error;}
  room=await call(a,'create');await call(b,'join',{p_code:room.code});
  const events={a:[],b:[],c:[]};
  for(const [i,client] of clients.entries()) {
    const seat=['a','b','c'][i];
    const channel=client.channel(`smoke-${seat}-${crypto.randomUUID()}`)
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'game_rooms',filter:`id=eq.${room.id}`},event=>events[seat].push(event));
    channels.push(channel);
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error(`Realtime subscribe timeout: ${seat}`)),12000);
      channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}else if(status==='CHANNEL_ERROR'){clearTimeout(timer);reject(Error(`Realtime subscribe failed: ${seat}`));}});
    });
  }
  const firstArgs={p_room:room.id,p_game:1,p_round:1,p_word:'海洋'};
  await call(a,'submit',firstArgs);
  await new Promise(resolve=>setTimeout(resolve,1400));
  for(const client of [a,b]) {
    const snapshot=await call(client,'sync',{p_room:room.id});
    assert.ok(!JSON.stringify(snapshot).includes('海洋'));
    const {data,error}=await client.from('game_rooms').select('*').eq('id',room.id);
    assert.equal(error,null);assert.equal(data.length,1);assert.ok(!JSON.stringify(data).includes('海洋'));
    const denied=await client.schema('private').from('game_guesses').select('*');assert.ok(denied.error);
  }
  const outsider=await c.from('game_rooms').select('*').eq('id',room.id);assert.deepEqual(outsider.data,[]);
  await assert.rejects(call(c,'join',{p_code:room.code}),/ROOM_FULL/);
  await assert.rejects(call(c,'submit',firstArgs),/NOT_MEMBER/);
  const forged=await a.from('game_rooms').update({phase:'won'}).eq('id',room.id);assert.ok(forged.error);
  assert.ok(events.a.length>0 && events.b.length>0,'Both members must receive live events');
  assert.ok(!JSON.stringify(events).includes('海洋'),'No secret word in Realtime payload before reveal');
  assert.equal(events.c.length,0,'Outsider must not receive room events');
  await Promise.all([call(a,'submit',firstArgs),call(b,'submit',{...firstArgs,p_word:'天空'})]);
  let state=await call(a,'sync',{p_room:room.id});assert.equal(state.phase,'reveal');assert.equal(state.history.length,1);
  await Promise.all([call(a,'advance',{p_room:room.id,p_game:1,p_round:1}),call(b,'advance',{p_room:room.id,p_game:1,p_round:1})]);
  const nextArgs={p_room:room.id,p_game:1,p_round:2,p_word:'雪'};
  await Promise.all([call(a,'submit',nextArgs),call(b,'submit',nextArgs)]);
  state=await call(b,'sync',{p_room:room.id});assert.equal(state.phase,'won');assert.equal(state.history.length,2);
  await Promise.all([call(a,'restart',{p_room:room.id,p_game:1}),call(b,'restart',{p_room:room.id,p_game:1})]);
  assert.equal((await call(a,'sync',{p_room:room.id})).game,2);
  await call(a,'leave',{p_room:room.id});assert.equal((await call(b,'sync',{p_room:room.id})).phase,'closed');
  console.log(JSON.stringify({passed:true,backend:url,auth:'3 isolated Supabase anonymous users',realtimeMemberEvents:{a:events.a.length,b:events.b.length},outsiderEvents:events.c.length,checks:['Auth','RPC','RLS read/write','private table denial','secret Realtime payload denial','live member events','outsider subscription denial','concurrent submits','reveal','advance','exact win','mutual rematch','close']},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{
  if(room)await call(a,'leave',{p_room:room.id}).catch(()=>{});
  for(const client of clients)await client.removeAllChannels();
}
