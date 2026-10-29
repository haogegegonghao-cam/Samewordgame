import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDatabase,A,B,C } from './database.mjs';
import { normalizeWord, validateWord, escapeHtml } from '../src/words.js';

test('Unicode and whitespace policy preserves meaning and case',()=>{
  assert.equal(normalizeWord('  ＡＢＣ\u3000\u00a0 白云\n'),'ABC 白云');
  assert.equal(normalizeWord('e\u0301'),'é');
  assert.notEqual(normalizeWord('蓝色'),normalizeWord('蔚蓝'));
  assert.notEqual(normalizeWord('Snow'),normalizeWord('snow'));
  assert.ok(validateWord('\u200b雪'));
  assert.ok(validateWord('雪'.repeat(25)));
  assert.equal(validateWord('雪'.repeat(24)),'');
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),'&lt;img src=x onerror=alert(1)&gt;');
});

test('real PostgreSQL: privacy, authorization, state machine and recovery',async t=>{
  const d=await makeDatabase();t.after(()=>d.close());
  let r=await d.rpc(A,'create');const id=r.id,code=r.code;
  assert.equal(code.length,10);assert.equal(r.phase,'waiting');
  await t.test('create retries recover the same room and join is idempotent',async()=>{
    assert.equal((await d.rpc(A,'create')).id,id);
    await assert.rejects(d.rpc(A,'submit',[id,1,1,'海洋']),/WRONG_PHASE/);
    assert.equal((await d.rpc(B,'join',[code])).phase,'thinking');
    assert.equal((await d.rpc(B,'join',[code])).seat,'b');
    assert.equal((await d.rpc(A,'join',[code])).seat,'a');
  });
  await t.test('third user cannot join, read, mutate or call private helpers',async()=>{
    await assert.rejects(d.rpc(C,'join',[code]),/ROOM_FULL/);
    assert.deepEqual(await d.as(C,'select * from public.game_rooms'),[]);
    await assert.rejects(d.rpc(C,'sync',[id]),/NOT_MEMBER/);
    await assert.rejects(d.rpc(C,'submit',[id,1,1,'海洋']),/NOT_MEMBER/);
    await assert.rejects(d.rpc(C,'leave',[id]),/NOT_MEMBER/);
    await assert.rejects(d.as(A,"update public.game_rooms set phase='won' where id=$1",[id]),/permission denied/);
    await assert.rejects(d.as(B,'select * from private.game_guesses'),/permission denied/);
    await assert.rejects(d.as(B,"select private.clean_word('雪')"),/permission denied/);
    await assert.rejects(d.rpc(null,'create'),/AUTH_REQUIRED/);
  });
  await t.test('first submission is unreadable in snapshot AND direct database reads',async()=>{
    r=await d.rpc(A,'submit',[id,1,1,'海洋']);
    assert.equal(r.phase,'thinking');assert.equal(r.submitted.a,true);assert.deepEqual(r.history,[]);
    const own=await d.rpc(A,'sync',[id]),other=await d.rpc(B,'sync',[id]);
    assert.ok(!JSON.stringify(own).includes('海洋'));assert.ok(!JSON.stringify(other).includes('海洋'));
    assert.ok(!JSON.stringify(await d.as(B,'select * from public.game_rooms')).includes('海洋'));
    assert.equal((await d.rpc(A,'submit',[id,1,1,'海洋'])).phase,'thinking');
    await assert.rejects(d.rpc(A,'submit',[id,1,1,'天空']),/ALREADY_SUBMITTED/);
    await assert.rejects(d.rpc(B,'submit',[id,1,1,'\u200b雪']),/INVALID_WORD/);
    await assert.rejects(d.rpc(B,'submit',[id,1,1,'雪'.repeat(25)]),/INVALID_WORD/);
  });
  await t.test('second submission atomically reveals, reload and duplicate POST preserve result',async()=>{
    r=await d.rpc(B,'submit',[id,1,1,'天空']);
    assert.equal(r.phase,'reveal');assert.deepEqual(r.history,[{round:1,a:'海洋',b:'天空',match:false}]);
    assert.equal((await d.rpc(B,'sync',[id])).phase,'reveal');
    assert.equal((await d.rpc(B,'submit',[id,1,1,'天空'])).history.length,1);
  });
  await t.test('both acknowledgements advance exactly once; stale posts cannot touch next turn',async()=>{
    assert.equal((await d.rpc(A,'advance',[id,1,1])).round,1);
    assert.equal((await d.rpc(A,'advance',[id,1,1])).round,1);
    const states=await Promise.all([d.rpc(A,'advance',[id,1,1]),d.rpc(B,'advance',[id,1,1])]);
    assert.equal(states.at(-1).round,2);assert.equal(states.at(-1).phase,'thinking');
    assert.equal((await d.rpc(A,'advance',[id,1,1])).round,2);
    await assert.rejects(d.rpc(B,'submit',[id,1,1,'雪']),/STALE_TURN/);
  });
  await t.test('synonyms and different case do not win; Unicode normalization does',async()=>{
    await Promise.all([d.rpc(A,'submit',[id,1,2,'蓝色']),d.rpc(B,'submit',[id,1,2,'蔚蓝'])]);
    assert.equal((await d.rpc(A,'sync',[id])).phase,'reveal');
    await d.rpc(A,'advance',[id,1,2]);await d.rpc(B,'advance',[id,1,2]);
    await d.rpc(A,'submit',[id,1,3,'Snow']);
    assert.equal((await d.rpc(B,'submit',[id,1,3,'snow'])).phase,'reveal');
    await d.rpc(A,'advance',[id,1,3]);await d.rpc(B,'advance',[id,1,3]);
    await d.rpc(A,'submit',[id,1,4,'  ＳＮＯＷ\u3000雪\n']);
    r=await d.rpc(B,'submit',[id,1,4,'SNOW 雪']);
    assert.equal(r.phase,'won');assert.equal(r.history.length,4);assert.equal(r.history.at(-1).a,'SNOW 雪');
    await assert.rejects(d.rpc(A,'advance',[id,1,4]),/WRONG_PHASE/);
  });
  await t.test('rematch requires both; stale rematch votes cannot reset a new game',async()=>{
    assert.equal((await d.rpc(A,'restart',[id,1])).game,1);
    r=await d.rpc(B,'restart',[id,1]);assert.equal(r.game,2);assert.equal(r.round,1);assert.deepEqual(r.history,[]);
    assert.equal((await d.rpc(A,'restart',[id,1])).game,2);
    await assert.rejects(d.rpc(A,'submit',[id,1,1,'雪']),/STALE_TURN/);
    assert.equal((await d.db.query('select count(*)::int as n from private.game_guesses')).rows[0].n,0);
  });
  await t.test('explicit leave closes room for both, no seat takeover; expiry is enforced',async()=>{
    await d.rpc(A,'submit',[id,2,1,'秘密']);
    assert.equal((await d.rpc(B,'leave',[id])).phase,'closed');
    assert.equal((await d.rpc(A,'sync',[id])).phase,'closed');
    await assert.rejects(d.rpc(C,'join',[code]),/ROOM_CLOSED/);
    await assert.rejects(d.rpc(A,'submit',[id,2,1,'秘密']),/ROOM_CLOSED/);
    assert.equal((await d.db.query('select count(*)::int as n from private.game_guesses')).rows[0].n,0);
    await d.db.query("update public.game_rooms set expires_at=now()-interval '1 second' where id=$1",[id]);
    await assert.rejects(d.rpc(A,'sync',[id]),/ROOM_UNAVAILABLE/);
    assert.deepEqual(await d.as(A,'select * from public.game_rooms'),[]);
    await assert.rejects(d.rpc(B,'join',[code]),/ROOM_UNAVAILABLE/);
  });
  await t.test('round 50 cannot overflow and supports mutual restart',async()=>{
    const fresh=await d.rpc(A,'create');await d.rpc(B,'join',[fresh.code]);
    await d.db.query('update public.game_rooms set round=50 where id=$1',[fresh.id]);
    await d.rpc(A,'submit',[fresh.id,1,50,'星星']);
    assert.equal((await d.rpc(B,'submit',[fresh.id,1,50,'月亮'])).phase,'reveal');
    await assert.rejects(d.rpc(A,'advance',[fresh.id,1,50]),/WRONG_PHASE/);
    await d.rpc(A,'restart',[fresh.id,1]);
    const restarted=await d.rpc(B,'restart',[fresh.id,1]);
    assert.equal(restarted.round,1);assert.equal(restarted.game,2);
    await d.rpc(A,'leave',[fresh.id]);
  });

});
