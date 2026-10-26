/**
 * Chromium end-to-end checks of the built Manifest V3 extension.
 * Requests for the mocked ChatGPT page never reach ChatGPT's servers.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,mkdtempSync,rmSync,mkdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

const dist=resolve('dist');
const conversationId='luna-stage-9-e2e';
const url='https://chatgpt.com/c/'+conversationId;
function createHtml(messageCount=2){
 const messages=Array.from({length:messageCount},(_,index)=>{const n=index+1;const question=n===1?'第一条测试问题':n===2?'第二条测试问题':`第${n}条测试问题`;return `<article data-turn="user" data-testid="conversation-turn-${n}" data-message-id="user-${n}" data-chatgpt-search-unit-key="turn-${n}:user" data-chatgpt-search-message-ids="user-${n}"><div data-message-author-role="user">${question}</div></article><article data-turn="assistant" data-message-id="answer-${n}" data-chatgpt-search-unit-key="turn-${n}:assistant" data-chatgpt-search-message-ids="answer-${n}"><h2>回答${n}</h2></article>`;}).join('');
 return ['<!doctype html><html lang="zh"><head><meta charset="UTF-8"><title>测试会话 - ChatGPT</title>','<style>body{margin:0;font-family:Arial}#root{display:flex;height:100vh}','#native-nav{width:170px;background:#eee;flex-shrink:0}','main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto}','#thread{flex:1;overflow:auto;padding:20px}article{box-sizing:border-box;height:72px;padding:12px}','#thread-bottom-container{padding:12px;border-top:1px solid #999}','.ProseMirror{border:1px solid #999;min-height:40px}</style></head><body>',`<div id="root"><nav id="native-nav"><a href="/c/${conversationId}">会话</a></nav>`,`<main id="chat-main"><div id="thread" class="thread-scroll-container">${messages}</div>`,'<div id="thread-bottom-container"><div class="ProseMirror" contenteditable="true" role="textbox" id="prompt-textarea"></div></div></main></div>','<script>window.addEventListener("load",()=>fetch("/backend-api/conversations/"+location.pathname.split("/").pop()+"?num_turns=4").catch(()=>{}))</script>','</body></html>'].join('');
}
/** Synthetic virtual host: only 24 pairs are mounted in the 500-turn scroll range. */
function createVirtualizedHtml(count){
  const script=[
    '<script>(function(){',
    'const thread=document.getElementById("thread");',
    'const turns=Array.from(thread.querySelectorAll("article"));',
    'const pairs=Array.from({length:'+count+'},(_,n)=>[turns[n*2],turns[n*2+1]]);',
    'const rowHeight=144,windowSize=24,overscan=5;',
    'const top=document.createElement("div"),visible=document.createElement("div"),bottom=document.createElement("div");',
    'thread.replaceChildren(top,visible,bottom);',
    'function render(){',
    'const start=Math.max(0,Math.min('+count+'-windowSize,Math.floor(thread.scrollTop/rowHeight)-overscan));',
    'top.style.height=(start*rowHeight)+"px";',
    'bottom.style.height=(('+count+'-start-windowSize)*rowHeight)+"px";',
    'visible.replaceChildren(...pairs.slice(start,start+windowSize).flatMap(pair=>pair));',
    '}',
    'thread.addEventListener("scroll",render);render();',
    '})()</script>'
  ].join('');
  return createHtml(count).replace('</body>',script+'</body>');
}
const html=createHtml(2),largeHtml=createHtml(500),virtualHtml=createVirtualizedHtml(500);
function createPayload(count){const messages=[];let parent=null;for(let n=1;n<=count;n++){messages.push({id:`user-${n}`,author:{role:'user'},content:{parts:[n===1?'第一条测试问题':n===2?'第二条测试问题':`第${n}条测试问题`]},parent,create_time:n*2-1});messages.push({id:`answer-${n}`,author:{role:'assistant'},content:{parts:[`回答${n}`]},parent:`user-${n}`,create_time:n*2});parent=`answer-${n}`;}return {messages,current_node:parent,page_info:{has_previous_page:false,has_next_page:false}};}
const payload=JSON.stringify(createPayload(2)),largePayload=JSON.stringify(createPayload(500));


/** Assert the requested user turn, not another turn, lies inside the feed viewport. */
async function waitForTurnVisible(page,messageId,timeout=15000){
  await page.waitForFunction((id)=>{
    const target=Array.from(document.querySelectorAll('[data-chatgpt-search-message-ids]'))
      .find(node=>node.getAttribute('data-chatgpt-search-message-ids')===id);
    const feed=document.querySelector('.thread-scroll-container');
    if(!target||!feed)return false;
    const rect=target.getBoundingClientRect(),bounds=feed.getBoundingClientRect();
    return rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1;
  },messageId,{timeout});
}

let fixtureOwner='fixture-account-a';
/** Intercept the real extension's host origin; all other HTTP traffic is denied. */
async function installFixture(context){
  await context.route('https://chatgpt.com/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(route.request().isNavigationRequest()){
      const path=new URL(route.request().url()).pathname;
       await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:path.includes('luna-stage-10-large-e2e')?largeHtml:path.includes('luna-stage-10-virtual-e2e')?virtualHtml:html});
    }else if(/^\/backend-api\/conversations\/[^/]+$/.test(p)){
      const id=p.split('/').pop();
       await route.fulfill({status:200,contentType:'application/json',body:id.startsWith('luna-stage-10-')?largePayload:payload});
    }else if(p==='/api/auth/session'){
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({user:{id:fixtureOwner}})});
    }else if(p==='/backend-api/me'||p==='/backend-api/accounts/check'){
      await route.fulfill({status:401,contentType:'application/json',body:'{}'});
    }else{
      await route.fulfill({status:404,contentType:'application/json',body:'{}'});
    }
  });
  await context.route(/^https?:\/\//,route=>
    new URL(route.request().url()).hostname==='chatgpt.com'
      ?route.fallback():route.abort('blockedbyclient'));
}

/** Confirm the background service worker is active in the disposable profile. */
async function extensionWorker(context){
  return context.serviceWorkers()[0]??context.waitForEvent('serviceworker',{timeout:20000});
}

test('Chromium MV3: TOC, search, layout, SPA and failure paths',{timeout:150000},async t=>{
  assert.ok(existsSync(join(dist,'manifest.json')),'build dist/ before E2E');
  const profile=mkdtempSync(join(tmpdir(),'luna-browser-'));
  let context,page;
  try{
    context=await chromium.launchPersistentContext(profile,{
      channel:'chromium',headless:true,viewport:{width:1280,height:800},
      args:['--disable-extensions-except='+dist,'--load-extension='+dist],
    });
    await installFixture(context);
    const worker=await extensionWorker(context);
    const extensionId=new URL(worker.url()).host;
    assert.match(extensionId,/^[a-p]{32}$/);
    page=await context.newPage();
    page.on('pageerror',error=>console.error('[fixture-pageerror]',error.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.locator('#luna-toc-sidebar.luna-toc-navigator-ready').waitFor({state:'attached',timeout:20000});
    // Host apps may fetch history before the asynchronous content UI is attached;
    // exercise another real window.fetch after the extension is ready.
    await page.evaluate(async id=>{await fetch('/backend-api/conversations/'+id+'?num_turns=4');},conversationId);

    await t.test('MAIN + ISOLATED content scripts build correct TOC',async()=>{
      await page.locator('.navigator-item').first().waitFor({state:'attached',timeout:5000}).catch(async error=>{
        const diagnostic=await page.evaluate(()=>({url:location.href,status:document.getElementById('luna-toc-status')?.textContent,
          list:document.getElementById('navigator-list')?.innerHTML.slice(0,500),
          sidebar:document.getElementById('luna-toc-sidebar')?.className}));
        console.error('[mock-TOC-diagnostic]',JSON.stringify(diagnostic));
        throw error;
      });
      assert.equal(await page.locator('.navigator-item').count(),2);
      assert.match(await page.locator('#navigator-list').innerText(),/第一条测试问题/);
      assert.match(await page.locator('#navigator-list').innerText(),/第二条测试问题/);
      assert.equal(await page.locator('#native-nav').count(),1);
      await page.waitForFunction(() => document.documentElement.hasAttribute('data-luna-toc-theme'));
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.waitForFunction(() => document.documentElement.dataset.lunaTocTheme === 'dark');
      assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-theme')), false);
      await page.evaluate(() => document.documentElement.classList.remove('dark'));
      await page.waitForFunction(() => document.documentElement.dataset.lunaTocTheme === 'light');
    });

    await t.test('repairs raw Markdown bold in dynamically mounted assistant answers only',async()=>{
      await page.evaluate(()=>{
        const answer=document.createElement('article');
        answer.setAttribute('data-chatgpt-search-unit-key','dynamic-answer:assistant');
        answer.setAttribute('data-message-author-role','assistant');
        const markdown=document.createElement('div');
        markdown.className='markdown';
        const paragraph=document.createElement('p');
        const tick=String.fromCharCode(96);
        paragraph.textContent='动态 **粗体内容**，代码 '+tick+'**行内代码**'+tick;
        const code=document.createElement('code');
        code.textContent='**代码元素**';
        const pre=document.createElement('pre');
        pre.textContent='**代码块**';
        const math=document.createElement('span');
        math.className='katex';
        math.textContent='**公式**';
        markdown.append(paragraph,code,pre,math);
        answer.append(markdown);
        document.querySelector('#thread')?.append(answer);
      });
      const answer=page.locator('[data-chatgpt-search-unit-key="dynamic-answer:assistant"]');
      await page.waitForFunction(()=>document.querySelector('[data-chatgpt-search-unit-key="dynamic-answer:assistant"] strong[data-luna-toc-markdown-bold="true"]')?.textContent==='粗体内容');
      assert.equal(await answer.locator('strong[data-luna-toc-markdown-bold="true"]').count(),1);
      assert.equal(await answer.locator('p').textContent(),'动态 粗体内容，代码 '+String.fromCharCode(96)+'**行内代码**'+String.fromCharCode(96));
      assert.equal(await answer.locator('code').textContent(),'**代码元素**');
      assert.equal(await answer.locator('pre').textContent(),'**代码块**');
      assert.equal(await answer.locator('.katex strong').count(),0);
      assert.equal(await answer.locator('.katex').textContent(),'**公式**');
      await page.waitForTimeout(50);
      assert.equal(await answer.locator('strong[data-luna-toc-markdown-bold="true"]').count(),1);
    });

    await t.test('reveal, search, view toggle and keyboard controls',async()=>{
      await page.locator('#luna-toc-toggle-btn').click({force:true});
      await page.locator('#luna-toc-sidebar[aria-hidden="false"]').waitFor();
      await page.locator('#search-toggle-btn').click();
      await page.locator('#navigator-search').fill('第二条');
      assert.equal(await page.locator('.navigator-item').count(),1);
      await page.locator('#navigator-search').fill('');
      await page.locator('#luna-toc-sidebar-pin-btn').focus();
      await page.keyboard.press('Alt+Shift+J');
      await page.locator('.navigator-jump-controls-visible').waitFor({state:'attached'});
      await page.locator('#toggle-view-mode-btn').click();
      assert.match(await page.locator('#navigator-title').innerText(),/Tips/);
      await page.locator('#toggle-view-mode-btn').click();
      await page.locator('#luna-toc-sidebar-pin-btn').focus();
      await page.keyboard.press('Alt+Shift+J');
      assert.equal(await page.locator('.navigator-jump-controls button:focus').count(),1);
    });

    await t.test('right-clicking a saved Tips item offers clear-all',async()=>{
      const promptKey='lumaToc:myPromptsV1';
      await worker.evaluate(async key=>{
        const current=(await chrome.storage.local.get(key))[key]??[];
        await chrome.storage.local.set({[key]:[...current,{
          id:'e2e-clear-prompt',ownerId:'fixture-account-a',title:'E2E Clear Prompt',
          content:'Prompt body',createdAt:1,updatedAt:1,
        }]});
      },promptKey);
      await page.locator('#toggle-view-mode-btn').click();
      const promptRow=page.locator('.my-prompts-item-row').filter({hasText:'E2E Clear Prompt'});
      await promptRow.waitFor({state:'attached'});
      await promptRow.click({button:'right'});
      await page.getByRole('menuitem',{name:'复制提示词'}).waitFor();
      await page.getByRole('menuitem',{name:'清空Tips'}).click();
      await page.getByRole('button',{name:'全部清空'}).click();
      await promptRow.waitFor({state:'detached'});
      const persisted=await worker.evaluate(async key=>(await chrome.storage.local.get(key))[key]??[],promptKey);
      assert.equal(persisted.some(prompt=>prompt.id==='e2e-clear-prompt'),false);
      assert.match(await page.locator('#navigator-title').innerText(),/Tips/);
    });

    await t.test('options propagate side-by-side, resize fallback and overlay',async()=>{
      const settings=await context.newPage();
      try{
        const optionsPage=await worker.evaluate(()=>chrome.runtime.getManifest().options_ui.page);
        await settings.goto('chrome-extension://'+extensionId+'/'+optionsPage);
        await settings.locator('input[name="sidebar-layout"][value="side-by-side"]').check();
        await page.locator('#chat-main.luna-toc-chat-side-by-side').waitFor({timeout:15000});
        assert.equal(await page.locator('#native-nav.luna-toc-chat-side-by-side').count(),0);
        await page.setViewportSize({width:700,height:800});
        await page.waitForFunction(()=>!document.getElementById('chat-main')?.classList.contains('luna-toc-chat-side-by-side'));
        await page.setViewportSize({width:1280,height:800});
        await page.locator('#chat-main.luna-toc-chat-side-by-side').waitFor();
        await settings.locator('input[name="sidebar-layout"][value="overlay"]').check();
        await page.waitForFunction(()=>!document.getElementById('chat-main')?.classList.contains('luna-toc-chat-side-by-side'));
      }finally{await settings.close();}
    });

    await t.test('SPA route, API failure and reload preserve host controls',async()=>{
      await page.evaluate(()=>history.pushState({},'','/c/other-conversation'));
      await page.evaluate(()=>fetch('/backend-api/unsupported').catch(()=>{}));
      assert.equal(await page.locator('.ProseMirror[contenteditable="true"]').count(),1);
      assert.equal(await page.locator('#native-nav').count(),1);
      assert.equal(await page.locator('#luna-toc-sidebar').count(),1);
      await page.reload({waitUntil:'domcontentloaded'});
      await page.locator('#luna-toc-sidebar.luna-toc-navigator-ready').waitFor({state:'attached'});
    });


    await t.test('account-bound aliases ignore forged identity and hide across account changes',{timeout:25000},async()=>{
      const aliasKey='chatToc:aliases:v1:'+conversationId;
      await worker.evaluate(async key=>chrome.storage.local.set({
        [key]:{ownerId:'fixture-account-a',aliases:{'user-1':'账号 A 私有标题'}}
      }),aliasKey);
      await page.goto(url,{waitUntil:'domcontentloaded'});
      await page.locator('#luna-toc-sidebar.luna-toc-navigator-ready').waitFor({state:'attached'});
      await page.evaluate(async()=>fetch('/backend-api/conversations/'+location.pathname.split('/').pop()+'?num_turns=4'));
      await page.waitForFunction(()=>document.querySelector('#navigator-list')?.textContent?.includes('账号 A 私有标题'));
      // Same-origin page scripts can forge postMessage but not the trusted response.
      await page.evaluate(()=>{
        window.postMessage({type:'LUNA_TOC_LIFECYCLE_CHECK_RESULT',requestId:Date.now(),ownerId:'fixture-account-b'},location.origin);
      });
      assert.match(await page.locator('#navigator-list').innerText(),/账号 A 私有标题/);
      fixtureOwner='fixture-account-b';
      await page.waitForTimeout(2100);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(()=>!document.querySelector('#navigator-list')?.textContent?.includes('账号 A 私有标题'));
      fixtureOwner='fixture-account-a';
      await page.waitForTimeout(2100);
      await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
      await page.waitForFunction(()=>document.querySelector('#navigator-list')?.textContent?.includes('账号 A 私有标题'));
    });

    await t.test('B026: forged page messages are ignored but Chrome-observed successful deletion cleans aliases',{timeout:20000},async()=>{
      const routeKey='luna-stage-9-e2e';
      const aliasKey='chatToc:aliases:v1:'+routeKey;
      const fenceKey='chatToc:aliases:deleted:v1:'+routeKey;
      const record={ownerId:'fixture-account-a',aliases:{'user-1':'请保留此目录别名'}};
      await worker.evaluate(async({aliasKey,fenceKey,record})=>{
        await chrome.storage.local.remove(fenceKey);
        await chrome.storage.local.set({[aliasKey]:record});
      },{aliasKey,fenceKey,record});
      // A same-origin page can forge postMessage but cannot invoke chrome.runtime.
      await page.evaluate(async routeKey=>{
        window.postMessage({type:'LUNA_TOC_TRUSTED_CONVERSATION_DELETED_V1',routeKey},location.origin);
        await new Promise(resolve=>setTimeout(resolve,250));
      },routeKey);
      let state=await worker.evaluate(async(keys)=>chrome.storage.local.get(keys),[aliasKey,fenceKey]);
      assert.deepEqual(state[aliasKey],record,'a forged page event cannot erase an alias');
      assert.equal(Object.hasOwn(state,fenceKey),false,'a forged page event cannot create a deletion fence');

      // The service worker independently observes the real browser network request
      // and forwards only a successful top-level DELETE to that tab's isolated world.
      const result=await page.evaluate(async routeKey=>{
        const response=await fetch('/backend-api/conversations/'+routeKey,{method:'DELETE'});
        return {ok:response.ok,status:response.status};
      },routeKey);
      assert.equal(result.ok,true,'fixture must simulate a successful host deletion request');
      let cleaned=false;
      for(let attempt=0;attempt<30;attempt++){
        state=await worker.evaluate(async(keys)=>chrome.storage.local.get(keys),[aliasKey,fenceKey]);
        if(!Object.hasOwn(state,aliasKey)&&state[fenceKey]===true){cleaned=true;break;}
        await page.waitForTimeout(100);
      }
      assert.equal(cleaned,true,'a successful browser-observed delete must persist a fence and remove the alias');
    });

    await t.test('500-message fully mounted fixture builds a TOC and supports a far jump',{timeout:60000},async()=>{
      const started=Date.now();
      await page.goto('https://chatgpt.com/c/luna-stage-10-large-e2e',{waitUntil:'domcontentloaded'});
      await page.locator('#luna-toc-sidebar.luna-toc-navigator-ready').waitFor({state:'attached',timeout:20000});
      await page.evaluate(async()=>fetch('/backend-api/conversations/luna-stage-10-large-e2e?num_turns=500'));
      await page.waitForFunction(()=>document.querySelectorAll('.navigator-item').length===500,undefined,{timeout:20000});
      const tocBuildMs=Date.now()-started,jumpStarted=Date.now();
      const sidebar=page.locator('#luna-toc-sidebar');
      if(await sidebar.getAttribute('aria-hidden')!=='false'){
        await page.locator('#luna-toc-toggle-btn').click({force:true});
        await page.locator('#luna-toc-sidebar[aria-hidden="false"]').waitFor({state:'visible'});
      }
      const lastItem=page.locator('.navigator-item').last();
      await lastItem.evaluate(element=>element.scrollIntoView({block:'nearest',inline:'nearest'}));
      await lastItem.click();
      await waitForTurnVisible(page,'user-500');
      console.log('[LunaTOC browser synthetic]',JSON.stringify({messages:500,environment:'headless Chromium fixture; no live ChatGPT',tocBuildMs,farJumpMs:Date.now()-jumpStarted}));
    });

    await t.test('500-message virtualized fixture mounts and jumps to an offscreen target',{timeout:60000},async()=>{
      await page.goto('https://chatgpt.com/c/luna-stage-10-virtual-e2e',{waitUntil:'domcontentloaded'});
      await page.locator('#luna-toc-sidebar.luna-toc-navigator-ready').waitFor({state:'attached',timeout:20000});
      await page.evaluate(async()=>fetch('/backend-api/conversations/luna-stage-10-virtual-e2e?num_turns=500'));
      await page.waitForFunction(()=>document.querySelectorAll('.navigator-item').length===500,undefined,{timeout:20000});
      const mountedBefore=await page.locator('[data-chatgpt-search-unit-key$=":user"]').count();
      assert.ok(mountedBefore<500,'fixture must not pre-mount the jump target');
      assert.equal(await page.locator('[data-chatgpt-search-message-ids="user-500"]').count(),0);
      const sidebar=page.locator('#luna-toc-sidebar');
      if(await sidebar.getAttribute('aria-hidden')!=='false'){
        await page.locator('#luna-toc-toggle-btn').click({force:true});
        await page.locator('#luna-toc-sidebar[aria-hidden="false"]').waitFor({state:'visible'});
      }
      const started=Date.now(),lastItem=page.locator('.navigator-item').last();
      await lastItem.evaluate(element=>element.scrollIntoView({block:'nearest',inline:'nearest'}));
      await lastItem.click();
      await waitForTurnVisible(page,'user-500',20000);
      const mountedAfter=await page.locator('[data-chatgpt-search-unit-key$=":user"]').count();
      assert.ok(mountedAfter<500,'virtualized fixture must keep a bounded DOM mount window');
      console.log('[LunaTOC browser synthetic virtual]',JSON.stringify({
        messages:500,environment:'headless Chromium virtual-scroll fixture; no live ChatGPT',
        mountedBefore,mountedAfter,farJumpMs:Date.now()-started
      }));
    });

    await t.test('backup export and restore use the shared background writer',async()=>{
      const settings=await context.newPage();
      try{
        const optionsPage=await worker.evaluate(()=>chrome.runtime.getManifest().options_ui.page);
        await settings.goto('chrome-extension://'+extensionId+'/'+optionsPage);
        await worker.evaluate(async()=>chrome.storage.local.set({
          'lumaToc:myPromptsV1':[{id:'e2e-prompt',ownerId:'fixture-account-a',title:'恢复测试',content:'private test prompt',createdAt:1,updatedAt:2}],
          'lunaToc:promptUsageV1':{'e2e-prompt':{usageCount:2,lastUsedAt:3}},
          'chatToc:accountSettings:v1':{
            'fixture-account-a':{
              theme:{followChatGPT:false,manualTheme:'light'},
              sidebar:{layoutMode:'overlay',backgroundColor:'default',revealTint:false}
            }
          }
        }));
        const downloadPromise=settings.waitForEvent('download');
        await settings.getByRole('button',{name:'导出本地数据'}).click();
        const download=await downloadPromise,filePath=await download.path();
        assert.ok(filePath,'backup download should complete');
        const backup=JSON.parse(readFileSync(filePath,'utf8'));
        assert.equal(backup.data.prompts[0].id,'e2e-prompt');
        assert.equal(backup.data.promptUsage['e2e-prompt'].usageCount,2);
        await worker.evaluate(async()=>chrome.storage.local.set({'lumaToc:myPromptsV1':[{id:'temporary',ownerId:'fixture-account-a',title:'temporary',content:'temporary',createdAt:1,updatedAt:2}], 'lunaToc:promptUsageV1':{temporary:{usageCount:1,lastUsedAt:3}}}));
        await settings.locator('input[type="file"]').setInputFiles({name:'luna-toc-e2e-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
        await settings.locator('.settings-backup-preview').waitFor({state:'visible'});
        settings.on('dialog',dialog=>dialog.accept());
        await settings.getByRole('button',{name:'确认恢复'}).click();
        const status=settings.locator('[role="status"]');
        const statusAppeared=await status.waitFor({state:'visible',timeout:15000}).then(()=>true).catch(()=>false);
        if(!statusAppeared){
          const bodyText=await settings.locator('body').innerText();
          const currentPrompts=await worker.evaluate(async()=>chrome.storage.local.get('lumaToc:myPromptsV1'));
          throw new Error('backup restore status missing; page='+bodyText.slice(-500)+'; storedPrompts='+JSON.stringify(currentPrompts));
        }
        const statusText=await status.innerText();
        assert.match(statusText,/恢复成功/, 'backup restore reported an error: '+statusText);
        const restored=await worker.evaluate(async()=>chrome.storage.local.get(['lumaToc:myPromptsV1','lunaToc:promptUsageV1','chatToc:accountSettings:v1']));
        assert.deepEqual(restored['lumaToc:myPromptsV1'].map(prompt=>prompt.id).sort(),['e2e-prompt','temporary']);
        assert.equal(restored['lunaToc:promptUsageV1'].temporary.usageCount,1);
        assert.equal(restored['lunaToc:promptUsageV1']['e2e-prompt'].usageCount,2);
        assert.deepEqual(restored['chatToc:accountSettings:v1']['fixture-account-a'].theme,backup.data.settings['fixture-account-a'].theme);
        assert.deepEqual(restored['chatToc:accountSettings:v1']['fixture-account-a'].sidebar,backup.data.settings['fixture-account-a'].sidebar);
      }finally{await settings.close();}
    });
  }catch(error){
    if(page&&!page.isClosed()){
      mkdirSync('artifacts/browser',{recursive:true});
      await page.screenshot({path:'artifacts/browser/failed.png',fullPage:true}).catch(()=>{});
    }
    throw error;
  }finally{
    await context?.close();
    rmSync(profile,{recursive:true,force:true});
  }
});
