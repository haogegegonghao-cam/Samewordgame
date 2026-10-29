import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const base=process.env.E2E_URL||'http://127.0.0.1:4173';
const cloud=Boolean(process.env.E2E_URL);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:1000}}),browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}),browser.newContext({viewport:{width:390,height:844}})]);
const [a,b,c]=await Promise.all(contexts.map(ctx=>ctx.newPage()));
const errors=[];[a,b,c].forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
const checks=[];
async function checked(name,task){await task();checks.push(name);console.log(`PASS ${name}`);}
async function waitText(page,text){await page.getByText(text,{exact:false}).first().waitFor({timeout:18000});}
async function safeReload(page){
  for(let attempt=0;attempt<3;attempt++) {
    const response=await page.reload();
    if(!response || response.status()<500) return;
    console.log(`Hosting returned HTTP ${response.status()} on reload; retry ${attempt+1}/3`);
    await page.waitForTimeout(700*(attempt+1));
  }
  throw new Error('Hosting kept returning HTTP 5xx on reload');
}
async function submit(page,word){await page.locator('#word-input').fill(word);await page.locator('#word-form').press('Enter');}
await mkdir('test-results',{recursive:true});
try{
  await checked('首页和手机布局无横向溢出',async()=>{
    await a.goto(base);await b.goto(base);
    await waitText(a,'你想到的，');
    await a.screenshot({path:'test-results/home-desktop.png',fullPage:true});
    await b.screenshot({path:'test-results/home-mobile.png',fullPage:true});
    for(const p of [a,b]) assert.ok(await p.evaluate(width=>document.documentElement.scrollWidth<=width,p.viewportSize().width),'page overflows viewport');
    await b.getByRole('button',{name:/怎么玩/}).click();await waitText(b,'相遇，只需要三个步骤。');
    await b.getByRole('button',{name:'明白了，去相遇'}).click();
  });
  let code,id;
  await checked('独立会话 A 创建，B 通过房间码加入',async()=>{
    await a.getByRole('button',{name:'开启一场相遇'}).click();await waitText(a,'留一个位置，');
    code=await a.locator('.room-code').innerText();code=code.replace(/\s/g,'');
    id=await a.evaluate(()=>localStorage.getItem('sameword-room-v1'));
    assert.equal(code.length,10);
    await a.screenshot({path:'test-results/waiting.png',fullPage:true});
    await b.getByRole('button',{name:'加入朋友的房间'}).click();
    await b.locator('#join-code').fill(code);await b.locator('#join-form').press('Enter');
    await waitText(b,'从一个词，开始认识彼此。');await waitText(a,'从一个词，开始认识彼此。');
  });
  await checked('第三个独立会话通过邀请链接不能进入',async()=>{
    await c.goto(`${base}?room=${code}`);await waitText(c,'这个房间已有两个人');
    assert.equal(await c.locator('.play-stage').count(),0);
  });
  await checked('A 提交后 B 页面及 API 快照均无秘密词，刷新恢复锁定状态',async()=>{
    await submit(a,'海洋');await waitText(a,'你的词，已经轻轻放好了。');
    assert.ok(!(await b.locator('body').innerText()).includes('海洋'));
    // Inspect the real HTTP response used by B, never a front-end-only assertion.
    const responsePromise=b.waitForResponse(r=>r.url().includes('/rpc/game_sync'));
    await safeReload(b);const response=await responsePromise;
    assert.ok(!(await response.text()).includes('海洋'));
    await safeReload(a);await waitText(a,'你的词，已经轻轻放好了。');
    assert.equal(await a.locator('#word-input').count(),0);
  });
  await checked('双方提交后揭晓，双方确认后只推进一轮',async()=>{
    await submit(b,'天空');await waitText(a,'两个词，离彼此近了一点。');await waitText(b,'两个词，离彼此近了一点。');
    for(const p of [a,b]){assert.equal((await p.locator('.card-word').allTextContents()).join('/'),'海洋/天空');}
    await a.getByRole('button',{name:'继续联想'}).click();await waitText(a,'准备好了，等对方一起');
    await b.getByRole('button',{name:'继续联想'}).click();await a.locator('#word-input').waitFor();await b.locator('#word-input').waitFor();
    assert.equal(await a.locator('.round-number').innerText(),'02');
  });
  await checked('断网与重连期间草稿保留，恢复后继续游戏',async()=>{
    await b.locator('#word-input').fill('蓝色');
    await contexts[1].setOffline(true);await waitText(b,'连接暂时中断');
    assert.equal(await b.locator('#word-input').inputValue(),'蓝色');
    await contexts[1].setOffline(false);
    await b.waitForFunction(()=>!document.querySelector('.network-banner'),null,{timeout:15000});
    assert.equal(await b.locator('#word-input').inputValue(),'蓝色');
  });
  await checked('两轮不同联想继续推进，手机思考与揭晓布局',async()=>{
    await Promise.all([submit(a,'蓝色'),submit(b,'云朵')]);await waitText(a,'两个词，离彼此近了一点。');
    await b.screenshot({path:'test-results/reveal-mobile.png',fullPage:true});
    await Promise.all([a.getByRole('button',{name:'继续联想'}).click(),b.getByRole('button',{name:'继续联想'}).click()]);
    await a.locator('#word-input').waitFor();await b.locator('#word-input').waitFor();
    await Promise.all([submit(a,'白色'),submit(b,'白云')]);await waitText(a,'两个词，离彼此近了一点。');
    await Promise.all([a.getByRole('button',{name:'继续联想'}).click(),b.getByRole('button',{name:'继续联想'}).click()]);
    await a.locator('#word-input').waitFor();await b.locator('#word-input').waitFor();
    await b.screenshot({path:'test-results/thinking-mobile.png',fullPage:true});
  });
  await checked('第 4 轮同时提交，精确匹配胜利，双方完整轨迹和手机布局',async()=>{
    await Promise.all([submit(a,' 雪　'),submit(b,'雪')]);await waitText(a,'在第 4 轮，我们相遇了。');await waitText(b,'在第 4 轮，我们相遇了。');
    assert.equal(await a.locator('.shared-word').innerText(),'雪');
    for(const p of [a,b]){assert.equal(await p.locator('.history-list li').count(),4);assert.ok(await p.evaluate(width=>document.documentElement.scrollWidth<=width,p.viewportSize().width),'page overflows viewport');}
    await a.waitForTimeout(2300);
    for(const width of [320,360,390,768]) {
      await b.setViewportSize({width,height:844});
      assert.ok(await b.evaluate(w=>document.documentElement.scrollWidth<=w,width),`win overflow at ${width}`);
    }
    await b.setViewportSize({width:390,height:844});
    await a.screenshot({path:'test-results/win-desktop.png',fullPage:true});await b.screenshot({path:'test-results/win-mobile.png',fullPage:true});
    const downloadPromise=a.waitForEvent('download');await a.getByRole('button',{name:/保存相遇卡片/}).click();
    const download=await downloadPromise;await download.saveAs('test-results/相遇卡片.png');
  });
  await checked('再来一局需要双方同意，刷新后还在新一局',async()=>{
    await a.getByRole('button',{name:'再来一场相遇'}).click();await waitText(a,'等对方点头，再来一局');
    await b.getByRole('button',{name:'再来一场相遇'}).click();await a.locator('#word-input').waitFor();await b.locator('#word-input').waitFor();
    assert.equal(await a.locator('.round-number').innerText(),'01');assert.equal(await a.locator('.history-list').count(),0);
    await safeReload(b);await b.locator('#word-input').waitFor();assert.equal(await b.locator('.round-number').innerText(),'01');
  });
  await checked('弹窗不会被后台同步关闭，明确离开关闭双方房间',async()=>{
    await b.getByRole('button',{name:/离开房间/}).click();await b.waitForTimeout(4500);
    assert.ok(await b.locator('dialog').isVisible());
    await b.getByRole('button',{name:'结束并离开'}).click();await waitText(b,'你想到的，');await waitText(a,'这场相遇，');
  });
  await checked('新的邀请链接在第二个独立会话中成功加入',async()=>{
    await a.getByRole('button',{name:'回到首页'}).click();
    await a.getByRole('button',{name:'开启一场相遇'}).click();await a.locator('.room-code').waitFor();
    const newCode=(await a.locator('.room-code').innerText()).replace(/\s/g,'');
    await b.goto(`${base}?room=${newCode}`);
    await a.locator('#word-input').waitFor();await b.locator('#word-input').waitFor();
    await a.getByRole('button',{name:/离开房间/}).click();await a.getByRole('button',{name:'结束并离开'}).click();
    await waitText(b,'这场相遇，');
  });
  assert.deepEqual(errors,[]);
  console.log(`\n${checks.length} browser checks passed. ${cloud?'CLOUD':'LOCAL PostgreSQL + compatible HTTP test transport; Supabase Cloud Realtime is not validated.'}`);
  await writeFile('test-results/e2e-report.json',JSON.stringify({date:new Date().toISOString(),target:base,transport:cloud?'cloud':'local-postgresql-http-fixture',checks,pageErrors:errors},null,2));
}catch(e){await Promise.all([a,b,c].map((p,i)=>p.screenshot({path:`test-results/failure-${i}.png`,fullPage:true}).catch(()=>{})));throw e;}
finally{await browser.close();}
