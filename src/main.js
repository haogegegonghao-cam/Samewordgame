import './style.css';
import { configured, client, authenticate, rpc, watchRoom, readableError } from './api.js';
import { normalizeWord, validateWord, formatCode, escapeHtml as esc } from './words.js';

const app = document.querySelector('#app');
const icons = {
  arrow: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm4 3q6 4 0 8m3-11q9 7 0 14"/></svg>',
  mute: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m11 5-6 4H2v6h3l6 4V5Zm5 4 6 6m0-6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
};
let room = null, stopWatch = null, busy = false, syncing = false, connected = navigator.onLine;
let wordDraft = '', joinDraft = '', signature = '', muted = true, toastTimer, lastSuccess = Date.now();
let audioContext, dialogReturnFocus;
const storageKey = 'sameword-room-v1';
function storedRoom() { try { return localStorage.getItem(storageKey); } catch { return null; } }
function saveRoom(id) { try { id ? localStorage.setItem(storageKey,id) : localStorage.removeItem(storageKey); } catch {} }
const inviteCode = formatCode(new URLSearchParams(location.search).get('room') || '');
function inviteLink() { const url = new URL(location.href); url.search = ''; url.hash = ''; url.searchParams.set('room',room.code); return url.href; }
const brand = `<a class="brand" href="./" aria-label="同词相遇 首页"><span class="brand-icon"><i></i><i></i></span><span>同词相遇<small>SAME WORD, SAME WORLD</small></span></a>`;
function header() { return `<header class="site-header">${brand}<nav aria-label="主要导航"><button class="text-button" data-action="help">怎么玩<span class="help-dot">?</span></button><button class="icon-button sound" data-action="sound" aria-label="${muted?'开启音效':'关闭音效'}" aria-pressed="${!muted}">${icons[muted?'mute':'sound']}</button></nav></header>`; }
function footer() { return `<footer class="site-footer"><span>两个词之间，藏着我们的距离。</span><span>MADE FOR TWO <i class="tiny-star">✳</i></span></footer>`; }
function orbit(kind='home') { return `<div class="orbit-art ${kind}" aria-hidden="true"><svg viewBox="0 0 520 430"><defs><linearGradient id="path-a"><stop stop-color="#567e9c" stop-opacity=".05"/><stop offset="1" stop-color="#567e9c" stop-opacity=".8"/></linearGradient><linearGradient id="path-b"><stop stop-color="#bc7758" stop-opacity=".7"/><stop offset="1" stop-color="#bc7758" stop-opacity=".05"/></linearGradient></defs><ellipse class="orbit-dash" cx="260" cy="215" rx="195" ry="142" transform="rotate(-24 260 215)"/><path class="line-a" d="M50 272C80 67 335 42 443 171S279 422 211 286"/><path class="line-b" d="M461 157C421 366 181 393 81 264S221 5 300 142"/><path class="orbit-cross" d="M254 209h12m-6-6v12"/><circle class="point-a" cx="103" cy="139" r="6"/><circle class="point-b" cx="417" cy="285" r="6"/></svg><span class="floating-word word-a">海洋<small>YOUR WORD</small></span><span class="floating-word word-b">天空<small>THEIR WORD</small></span><span class="orbit-note">不同的起点，同一个终点。</span></div>`; }
function home() {
  return `${header()}<main id="main"><section class="home-hero"><div class="hero-copy"><p class="eyebrow"><span class="mini-line"></span>一场关于默契的小小实验</p><h1>你想到的，<br>刚好<span class="serif-em">也是我</span>。</h1><p class="hero-description">从两个毫不相干的词开始，<br>沿着彼此的联想，走到同一个答案。</p><div class="home-actions"><button class="button primary" data-action="create"><span class="button-dot"></span>开启一场相遇 ${icons.arrow}</button><button class="button secondary" data-action="join-dialog">加入朋友的房间 <span class="plus">+</span></button></div><p class="microcopy">两个人 · 无需注册 · 没有标准答案</p></div>${orbit()}</section><section class="how-strip" aria-label="三步开始"><div class="strip-intro"><span class="eyebrow">HOW WE MEET</span><h2>让思维，慢慢靠近。</h2></div><div class="how-step"><span>01</span><div><h3>各写一个词</h3><p>从此刻脑海中的任意词语开始。</p></div></div><div class="how-step"><span>02</span><div><h3>一起揭晓，再联想</h3><p>顺着两个词，寻找新的交点。</p></div></div><div class="how-step"><span>03</span><div><h3>直到，我们同词相遇</h3><p>写下相同的词，就是默契的瞬间。</p></div></div></section></main>${footer()}`;
}
function playerCard(seat, me, content, label) {
  const mine = seat===me;
  return `<div class="word-card ${seat} ${content?'revealed':''}"><div class="card-caption"><span><i class="player-dot"></i>${mine?'你的词':'对方的词'}</span><span>${label}</span></div><div class="card-word ${!content?'unrevealed':''}">${content?esc(content):'<span class="secret-dots">· · ·</span>'}</div></div>`;
}
function historyView() {
  if (!room.history.length) return '';
  return `<section class="history-section"><div class="section-label"><h2>我们的联想轨迹</h2><span>${String(room.history.length).padStart(2,'0')} 个交点的尝试</span></div><ol class="history-list">${room.history.map(h=>`<li class="${h.match?'is-match':''}"><span class="history-number">${String(h.round).padStart(2,'0')}</span><span class="history-word a">${esc(h.a)}</span><span class="history-connector">${h.match?'✳':'······'}</span><span class="history-word b">${esc(h.b)}</span>${h.match?'<span class="match-note">相遇</span>':''}</li>`).join('')}</ol></section>`;
}
function gameView() {
  const { phase, seat, round, code, submitted, ready, history, online }=room;
  const other=seat==='a'?'b':'a';
  const latest=history.at(-1);
  const connection=!connected?'正在重新连接':(online[other]?'彼此在线':(room.joined?'等待对方回来':'等待朋友加入'));
  let content='';
  if (phase==='waiting') content=`<section class="waiting-stage"><p class="eyebrow">THE OTHER HALF IS ON THE WAY</p><h1>留一个位置，<br>给想到的那个人。</h1><div class="waiting-orbits" aria-hidden="true"><i></i><i></i><span>+</span></div><p class="stage-description">把邀请发给朋友。<br>对方加入后，这场相遇就开始了。</p><div class="invite-block"><span class="eyebrow">房间码</span><button class="room-code" data-action="copy-code" aria-label="复制房间码 ${code}">${code.slice(0,5)} <span>${code.slice(5)}</span>${icons.copy}</button><button class="button primary" data-action="invite">分享邀请链接 ${icons.arrow}</button><span class="microcopy">仅限两人 · 房间保留 24 小时</span></div></section>`;
  else if(phase==='closed') content=`<section class="closed-stage"><p class="eyebrow">UNTIL NEXT TIME</p><h1>这场相遇，<br>先停在这里。</h1><p class="stage-description">有一位玩家离开了房间。<br>谢谢这一路共同的想象。</p><button class="button primary" data-action="home">回到首页 ${icons.arrow}</button>${historyView()}</section>`;
  else if(phase==='won') content=`<section class="win-stage" aria-labelledby="win-title"><p class="eyebrow"><i class="tiny-star">✳</i> TWO MINDS. ONE WORD.</p><h1 id="win-title">在第 ${round} 轮，我们相遇了。</h1><div class="meeting-word"><span class="meeting-ring a"></span><span class="meeting-ring b"></span><span class="shared-word">${esc(latest.a)}</span><span class="meeting-caption">你想到了，我也一样。</span></div><p class="win-description">原来沿着不同的想象，也能走到彼此心里。</p><div class="win-actions"><button class="button primary" data-action="restart" ${ready[seat]?'disabled':''}>${ready[seat]?'等对方点头，再来一局':'再来一场相遇'} ${icons.arrow}</button><button class="button secondary" data-action="share-result">分享这份默契 ${icons.copy}</button><button class="text-button" data-action="download">保存相遇卡片 ↓</button></div>${ready[other]&&!ready[seat]?'<p class="ready-note">对方想再来一局，正在等你。</p>':''}</section>${historyView()}`;
  else {
    const revealing=phase==='reveal';
    const atLimit=round===50;
    const title=revealing?'两个词，离彼此近了一点。':round===1?'从一个词，开始认识彼此。':'顺着联想，再靠近一点。';
    const prompt=revealing?'把这两个词放在一起，你会想到什么？':latest?`从「${esc(latest.a)}」和「${esc(latest.b)}」出发，写下新的联想。`:'不用想太久，写下此刻脑海中出现的一个词。';
    content=`<section class="play-stage"><p class="eyebrow">ROUND <span class="round-number">${String(round).padStart(2,'0')}</span><span class="eyebrow-separator"></span>${revealing?'这一刻，一起揭晓':'两个独立的想象'}</p><h1>${title}</h1><p class="stage-description">${prompt}</p><div class="word-pair ${revealing?'reveal-pair':''}">${playerCard('a',seat,revealing?latest.a:'',revealing?'已揭晓':submitted.a?'已锁定':'正在联想')}${playerCard('b',seat,revealing?latest.b:'',revealing?'已揭晓':submitted.b?'已锁定':'正在联想')}<span class="pair-symbol" aria-hidden="true">${revealing?'↔':'&'}</span></div><div class="input-stage">${revealing?`<p class="next-caption">${atLimit?'50 轮想象，也是一段很长的同行。要从新的起点再来吗？':'没有相同也没关系，默契正在发生。'}</p><button class="button primary" data-action="${atLimit?'restart':'advance'}" ${ready[seat]?'disabled':''}>${ready[seat]?'准备好了，等对方一起':atLimit?'从头再来': '继续联想'} ${icons.arrow}</button><p class="microcopy">${ready[other]&&!ready[seat]?'对方已经准备好了。':'双方准备好后，一起出发。'}</p>`:submitted[seat]?`<div class="submitted-state"><span class="waiting-pulse"><i></i><i></i><i></i></span><h2>你的词，已经轻轻放好了。</h2><p>等对方写完，我们一起揭晓。</p><small>即使刷新页面，提交也会保留。</small></div>`:`<form id="word-form"><label for="word-input">这一次，你想到的是</label><div class="word-input-wrap"><input id="word-input" name="word" placeholder="写下一个词…" autocomplete="off" spellcheck="false" enterkeyhint="send" aria-describedby="word-help word-error" value="${esc(wordDraft)}"><button class="submit-word" type="submit" aria-label="锁定并提交词语">${icons.arrow}</button></div><div class="input-meta"><span id="word-help">提交后锁定，双方写完才揭晓。</span><span id="word-count">${[...normalizeWord(wordDraft)].length} / 24</span></div><p id="word-error" class="field-error" role="alert"></p></form>`}</div></section>${historyView()}`;
  }
  return `${header()}<main id="main" class="game-main"><div class="room-toolbar"><span class="room-label">相遇房间 <button class="text-button code-small" data-action="copy-code">${code.slice(0,5)} ${code.slice(5)} ${icons.copy}</button></span><span class="connection ${!connected?'offline':''}" role="status"><i></i><span>${connection}</span></span><button class="text-button invite-small" data-action="invite">邀请链接 ${icons.copy}</button></div>${!connected?'<div class="network-banner" role="status">连接暂时中断。恢复网络后会自动同步，请保留此页面。<button data-action="sync">重试</button></div>':''}${content}<div class="room-bottom"><span>不必猜对，只要一起想。</span>${phase!=='closed'?'<button class="text-button" data-action="leave-dialog">离开房间 ↗</button>':''}</div></main>${footer()}`;
}
function render() {
  const active=document.activeElement;
  const id=active?.id, start=active?.selectionStart, end=active?.selectionEnd;
  app.innerHTML=room?gameView():home();
  if(id && document.getElementById(id)) {
    const input=document.getElementById(id); input.focus({preventScroll:true});
    if(start!=null && input.setSelectionRange) input.setSelectionRange(start,end);
  }
  setBusy(busy);
}
function setBusy(value) {
  busy=value;
  app.setAttribute('aria-busy',String(value));
  app.querySelectorAll('button').forEach(button=>{
    if(value && !button.disabled) { button.dataset.pending='true'; button.disabled=true; }
    else if(!value && button.dataset.pending) { button.disabled=false; delete button.dataset.pending; }
  });
}
function toast(message) {
  let el=document.querySelector('#toast');
  if(!el) { el=document.createElement('div'); el.id='toast'; el.className='toast'; el.setAttribute('role','status'); document.body.append(el); }
  el.textContent=message; el.classList.add('visible'); clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('visible'),4200);
}
function applyRoom(next) {
  if(room && next.id===room.id && (next.game<room.game || (next.game===room.game && next.revision<room.revision))) return;
  const previous=room;
  room=next; saveRoom(next.id);
  const nextSignature=JSON.stringify(next);
  if(signature!==nextSignature) {
    const turnChanged=!previous || previous.game!==next.game || previous.round!==next.round;
    if(turnChanged) wordDraft='';
    signature=nextSignature; render();
    if(turnChanged && next.phase==='thinking') document.getElementById('word-input')?.focus({preventScroll:true});
    if(previous?.phase!==next.phase && ['reveal','won'].includes(next.phase)) {
      playTone(next.phase==='won');
      if(next.phase==='won') document.getElementById('win-title')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});
    }
  }
}
async function sync() {
  if(!room || !configured || syncing || busy || document.hidden) return;
  syncing=true;
  const requestedRoom=room.id;
  try {
    const next=await rpc('sync',{p_room:requestedRoom});
    if(!room || room.id!==requestedRoom) return;
    lastSuccess=Date.now();
    const was=connected; connected=true;
    applyRoom(next); if(!was) render();
  } catch(error) {
    if(!room || room.id!==requestedRoom) return;
    if(/NOT_MEMBER|ROOM_UNAVAILABLE/.test(error.message)) { clearRoom(); toast(readableError(error)); }
    else if(Date.now()-lastSuccess>10000) { connected=false; render(); }
  } finally { syncing=false; }
}
function subscribe() {
  stopWatch?.();
  stopWatch=watchRoom(room.id,()=>sync(),status=>{ if(status==='SUBSCRIBED') sync(); });
}
async function act(task) {
  if(busy) return;
  setBusy(true);
  try { await task(); lastSuccess=Date.now(); connected=true; }
  catch(error) { toast(readableError(error)); if(room) setTimeout(sync,20); }
  finally { setBusy(false); }
}
async function enter(action,args) {
  await authenticate();
  applyRoom(await rpc(action,args)); subscribe();
  const url=new URL(location.href); url.search=''; url.hash=''; history.replaceState(null,'',url);
  window.scrollTo({top:0,behavior:'instant'});
}
function clearRoom() {
  stopWatch?.(); stopWatch=null; room=null; signature=''; wordDraft=''; saveRoom(null);
  const url=new URL(location.href); url.search=''; url.hash=''; history.replaceState(null,'',url);
  render();
}
async function copy(text,message) {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch { showDialog('copy',text); }
}
async function invite() {
  const url=inviteLink();
  if(navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({title:'同词相遇',text:'来和我玩一场词语联想，看看我们的思维会在哪里相遇。',url}); return; }
    catch(e) { if(e.name==='AbortError') return; }
  }
  await copy(url,'邀请链接已复制，发给那个想到的人吧。');
}
function resultText() {
  return `同词相遇 · 我们在第 ${room.round} 轮相遇了\n${room.history.map(h=>`${String(h.round).padStart(2,'0')}  ${h.a} / ${h.b}`).join('\n')}\n你想到了，我也一样。\n${location.origin+location.pathname}`;
}
async function shareResult() {
  if(navigator.share) { try { await navigator.share({title:'同词相遇 · 我们的联想轨迹',text:resultText()}); return; } catch(e) { if(e.name==='AbortError') return; } }
  await copy(resultText(),'相遇历程已复制。');
}
async function downloadCard() {
  const canvas=document.createElement('canvas'); canvas.width=1200; canvas.height=970+room.history.length*60;
  const c=canvas.getContext('2d'); c.fillStyle='#f7f5ef'; c.fillRect(0,0,canvas.width,canvas.height);
  const text=(s,x,y,size,color='#252c2b',font='serif')=>{c.font=`${size}px ${font}`;c.fillStyle=color;c.textAlign='center';c.fillText(s,x,y,1050);};
  text('同 词 相 遇',600,110,34); text('TWO MINDS. ONE WORD.',600,160,16,'#777b76','sans-serif');
  c.lineWidth=2; c.strokeStyle='#567e9c55';c.beginPath();c.ellipse(550,400,210,170,-.3,0,Math.PI*2);c.stroke();
  c.strokeStyle='#bc775855';c.beginPath();c.ellipse(650,400,210,170,.3,0,Math.PI*2);c.stroke();
  text(room.history.at(-1).a,600,430,Math.min(100,850/([...room.history.at(-1).a].length||1)));
  text(`在第 ${room.round} 轮，我们相遇了。`,600,650,36);
  room.history.forEach((h,i)=>{
    text(String(h.round).padStart(2,'0'),150,765+i*60,20,'#9b9b92','sans-serif');
    text(h.a,420,765+i*60,26,'#567e9c');text('·',600,765+i*60,20,'#9b9b92');text(h.b,790,765+i*60,26,'#bc7758');
  });
  text('你想到了，我也一样。',600,canvas.height-90,22,'#777b76');
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob) return toast('卡片生成失败，请尝试复制分享。');
  const file=new File([blob],'同词相遇.png',{type:'image/png'});
  if(matchMedia('(pointer: coarse)').matches && navigator.canShare?.({files:[file]})) { try { await navigator.share({files:[file],title:'同词相遇'}); return; } catch(e) { if(e.name==='AbortError') return; } }
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='同词相遇.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('相遇卡片已生成。');
}
function showDialog(type,value='') {
  document.querySelector('dialog')?.remove();
  dialogReturnFocus=document.activeElement;
  const dialog=document.createElement('dialog'); dialog.className='modal';
  let body='';
  if(type==='help') body=`<p class="eyebrow">A LITTLE GUIDE</p><h2 id="dialog-title">相遇，只需要三个步骤。</h2><ol class="guide-list"><li><span>01</span><div><h3>邀请一个人</h3><p>创建房间，把链接或房间码发给朋友。</p></div></li><li><span>02</span><div><h3>写下一个词，一起揭晓</h3><p>第一轮自由写词。之后根据上一轮的两个词，自由联想新的词。写完后就锁定了，对方提交前看不到你的词。</p></div></li><li><span>03</span><div><h3>直到写下同一个词</h3><p>不猜近义词，只等完全相同的答案。没有倒计时，也不用着急。</p></div></li></ol><p class="dialog-note">全角与半角、首尾与连续空白会标准化。文字和大小写不同，仍是不同的词。</p><button class="button primary full" data-action="close-dialog">明白了，去相遇 ${icons.arrow}</button>`;
  if(type==='join') body=`<p class="eyebrow">FOLLOW THEIR THOUGHTS</p><h2 id="dialog-title">有人，在等你。</h2><p class="dialog-description">输入朋友分享的 10 位房间码。</p><form id="join-form"><label class="sr-only" for="join-code">房间码</label><input id="join-code" class="code-input" placeholder="例如 ABCDE 23456" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(value||joinDraft)}" aria-describedby="join-error"><p id="join-error" class="field-error" role="alert"></p><button type="submit" class="button primary full">进入房间 ${icons.arrow}</button></form><p class="dialog-note">房间只容纳两个人。邀请在创建后 24 小时内有效。</p>`;
  if(type==='setup') body=`<p class="eyebrow">ALMOST READY</p><h2 id="dialog-title">相遇之前，还差一步。</h2><p class="dialog-description">这个网址还没有连接联机服务。网站部署者需要完成项目 README 中的 Supabase 配置。</p><p class="dialog-note">连接完成后，你和朋友就能从各自的手机或电脑开始游戏，无需注册。</p><button class="button primary full" data-action="close-dialog">知道了 ${icons.arrow}</button>`;
  if(type==='leave') body=`<p class="eyebrow">TAKE YOUR TIME</p><h2 id="dialog-title">要结束这场相遇吗？</h2><p class="dialog-description">离开会为双方关闭房间。只是暂时离开屏幕的话，直接关闭页面就好，回来还能继续。</p><div class="dialog-actions"><button class="button secondary" data-action="close-dialog">继续联想</button><button class="button primary" data-action="leave">结束并离开</button></div>`;
  if(type==='copy') body=`<h2 id="dialog-title">长按或选中复制</h2><label class="sr-only" for="manual-copy">分享内容</label><textarea id="manual-copy" readonly>${esc(value)}</textarea><button class="button primary full" data-action="close-dialog">完成</button>`;
  dialog.innerHTML=`<div class="dialog-inner"><button class="icon-button dialog-close" data-action="close-dialog" aria-label="关闭对话框">${icons.close}</button>${body}</div>`;
  dialog.setAttribute('aria-labelledby','dialog-title');document.body.append(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();dialogReturnFocus?.focus({preventScroll:true});});
  dialog.addEventListener('click',e=>{ if(e.target===dialog) dialog.close(); });
  dialog.showModal();
  const input=dialog.querySelector('input,textarea'); if(input) { input.focus(); if(input instanceof HTMLTextAreaElement) input.select(); }
}
function playTone(win=false) {
  if(muted) return;
  try {
    audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();
    (win?[392,493.88,587.33,783.99]:[440,554.37]).forEach((freq,i)=>{
      const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();
      oscillator.type='sine'; oscillator.frequency.value=freq;
      const t=audioContext.currentTime+i*.14;
      gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.045,t+.035);gain.gain.exponentialRampToValueAtTime(.001,t+.8);
      oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(t);oscillator.stop(t+.85);
    });
  } catch {}
}
document.addEventListener('click',async e=>{
  const button=e.target.closest('[data-action]'); if(!button || button.disabled) return;
  const action=button.dataset.action;
  if(action==='close-dialog') return button.closest('dialog').close();
  if(action==='help') return showDialog('help');
  if(action==='sound') {
    muted=!muted; if(!muted) playTone();
    const sound=document.querySelector('.sound');sound.innerHTML=icons[muted?'mute':'sound'];sound.setAttribute('aria-label',muted?'开启音效':'关闭音效');sound.setAttribute('aria-pressed',String(!muted));return;
  }
  if(action==='create') return configured?act(()=>enter('create')):showDialog('setup');
  if(action==='join-dialog') return configured?showDialog('join'):showDialog('setup');
  if(action==='invite') return invite();
  if(action==='copy-code') return copy(room.code,'房间码已复制。');
  if(action==='leave-dialog') return showDialog('leave');
  if(action==='home') return clearRoom();
  if(action==='sync') return sync();
  if(action==='share-result') return shareResult();
  if(action==='download') return downloadCard();
  if(action==='leave') { button.closest('dialog').close(); return act(async()=>{await rpc('leave',{p_room:room.id});clearRoom();}); }
  if(action==='advance'||action==='restart') return act(async()=>{
    const args={p_room:room.id,p_game:room.game}; if(action==='advance') args.p_round=room.round;
    applyRoom(await rpc(action,args));
  });
});
document.addEventListener('input',e=>{
  if(e.target.id==='word-input') {wordDraft=e.target.value;document.getElementById('word-count').textContent=`${[...normalizeWord(wordDraft)].length} / 24`;document.getElementById('word-error').textContent='';e.target.removeAttribute('aria-invalid');}
  if(e.target.id==='join-code') joinDraft=e.target.value;
});
document.addEventListener('keydown',e=>{
  if(e.target.id==='word-input' && e.key==='Enter' && (e.isComposing || e.keyCode===229)) e.preventDefault();
});
document.addEventListener('submit',e=>{
  if(!['word-form','join-form'].includes(e.target.id)) return;
  e.preventDefault(); if(busy) return;
  if(e.target.id==='join-form') {
    const code=formatCode(document.getElementById('join-code').value);
    if(code.length!==10) {document.getElementById('join-error').textContent='请输入完整的 10 位房间码。';return;}
    return act(async()=>{await enter('join',{p_code:code});document.querySelector('dialog')?.close();});
  }
  const error=validateWord(wordDraft);
  if(error) {document.getElementById('word-error').textContent=error;document.getElementById('word-input').setAttribute('aria-invalid','true');return;}
  const args={p_room:room.id,p_game:room.game,p_round:room.round,p_word:normalizeWord(wordDraft)};
  act(async()=>{applyRoom(await rpc('submit',args));});
});
document.addEventListener('click',e=>{
  if(e.target.closest('.brand') && room) {e.preventDefault();showDialog('leave');}
});
window.addEventListener('offline',()=>{connected=false;render();});
window.addEventListener('online',()=>{sync();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden) sync();});
window.addEventListener('pageshow',()=>sync());
// Realtime is the fast path. Poll recovers missed events, sleeping tabs and WS failures.
setInterval(sync,4000);
render();
async function boot() {
  if(!configured) { if(inviteCode) showDialog('setup'); return; }
  const previous=storedRoom(); if(!previous && !inviteCode) return;
  await act(async()=>{
    await authenticate();
    if(inviteCode) { applyRoom(await rpc('join',{p_code:inviteCode}));subscribe(); }
    else {
      try {applyRoom(await rpc('sync',{p_room:previous}));subscribe();}
      catch(e) {if(/NOT_MEMBER|ROOM_UNAVAILABLE/.test(e.message)) saveRoom(null);throw e;}
    }
  });
}
boot();
