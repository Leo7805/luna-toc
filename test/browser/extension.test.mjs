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
 const messages=Array.from({length:messageCount},(_,index)=>{const n=index+1;const question=n===1?'第一条测试问题':n===2?'第二条测试问题':`第${n}条测试问题`;return `<article data-turn="user" data-testid="conversation-turn-${n}" data-message-id="user-${n}"><div data-message-author-role="user">${question}</div></article><article data-turn="assistant" data-message-id="answer-${n}"><h2>回答${n}</h2></article>`;}).join('');
 return ['<!doctype html><html lang="zh"><head><meta charset="UTF-8"><title>测试会话 - ChatGPT</title>','<style>body{margin:0;font-family:Arial}#root{display:flex;height:100vh}','#native-nav{width:170px;background:#eee;flex-shrink:0}','main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto}','#thread{flex:1;overflow:auto;padding:20px}article{padding:24px}','#thread-bottom-container{padding:12px;border-top:1px solid #999}','.ProseMirror{border:1px solid #999;min-height:40px}</style></head><body>',`<div id="root"><nav id="native-nav"><a href="/c/${conversationId}">会话</a></nav>`,`<main id="chat-main"><div id="thread">${messages}</div>`,'<div id="thread-bottom-container"><div class="ProseMirror" contenteditable="true" role="textbox" id="prompt-textarea"></div></div></main></div>','<script>window.addEventListener("load",()=>fetch("/backend-api/conversations/"+location.pathname.split("/").pop()+"?num_turns=4").catch(()=>{}))</script>','</body></html>'].join('');
}
const html=createHtml(2),largeHtml=createHtml(500);
function createPayload(count){const messages=[];let parent=null;for(let n=1;n<=count;n++){messages.push({id:`user-${n}`,author:{role:'user'},content:{parts:[n===1?'第一条测试问题':n===2?'第二条测试问题':`第${n}条测试问题`]},parent,create_time:n*2-1});messages.push({id:`answer-${n}`,author:{role:'assistant'},content:{parts:[`回答${n}`]},parent:`user-${n}`,create_time:n*2});parent=`answer-${n}`;}return {messages,current_node:parent,page_info:{has_previous_page:false,has_next_page:false}};}
const payload=JSON.stringify(createPayload(2)),largePayload=JSON.stringify(createPayload(500));

/** Intercept the real extension's host origin; all other HTTP traffic is denied. */
async function installFixture(context){
  await context.route('https://chatgpt.com/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(route.request().isNavigationRequest()){
      const path=new URL(route.request().url()).pathname;
       await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:path.includes('luna-stage-10-large-e2e')?largeHtml:html});
    }else if(/^\/backend-api\/conversations\/[^/]+$/.test(p)){
      const id=p.split('/').pop();
       await route.fulfill({status:200,contentType:'application/json',body:id==='luna-stage-10-large-e2e'?largePayload:payload});
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
      assert.match(await page.locator('#navigator-title').innerText(),/我的提示词/);
      await page.locator('#toggle-view-mode-btn').click();
      await page.locator('#luna-toc-sidebar-pin-btn').focus();
      await page.keyboard.press('Alt+Shift+J');
      assert.equal(await page.locator('.navigator-jump-controls button:focus').count(),1);
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

    await t.test('500-message synthetic conversation builds a TOC and supports far jumps',{timeout:60000},async()=>{
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
      await page.waitForFunction(()=>{const target=document.querySelector('[data-message-id="user-500"]');if(!target)return false;const rect=target.getBoundingClientRect();return rect.top>=0&&rect.bottom<=window.innerHeight;},undefined,{timeout:15000});
      console.log('[LunaTOC browser synthetic]',JSON.stringify({messages:500,environment:'headless Chromium fixture; no live ChatGPT',tocBuildMs,farJumpMs:Date.now()-jumpStarted}));
    });
    await t.test('backup export and restore use the shared background writer',async()=>{
      const settings=await context.newPage();
      try{
        const optionsPage=await worker.evaluate(()=>chrome.runtime.getManifest().options_ui.page);
        await settings.goto('chrome-extension://'+extensionId+'/'+optionsPage);
        await worker.evaluate(async()=>chrome.storage.local.set({
          'lumaToc:myPromptsV1':[{id:'e2e-prompt',title:'恢复测试',content:'private test prompt',createdAt:1,updatedAt:2}],
          'lunaToc:promptUsageV1':{'e2e-prompt':{usageCount:2,lastUsedAt:3}},
          'chatToc:themeSettings':{followChatGPT:false,manualTheme:'light'},
          'chatToc:sidebarPreferences':{layoutMode:'overlay',backgroundColor:'default',revealTint:false}
        }));
        const downloadPromise=settings.waitForEvent('download');
        await settings.getByRole('button',{name:'导出本地数据'}).click();
        const download=await downloadPromise,filePath=await download.path();
        assert.ok(filePath,'backup download should complete');
        const backup=JSON.parse(readFileSync(filePath,'utf8'));
        assert.equal(backup.data.prompts[0].id,'e2e-prompt');
        assert.equal(backup.data.promptUsage['e2e-prompt'].usageCount,2);
        await worker.evaluate(async()=>chrome.storage.local.set({'lumaToc:myPromptsV1':[{id:'temporary',title:'temporary',content:'temporary',createdAt:1,updatedAt:2}]}));
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
        const restored=await worker.evaluate(async()=>chrome.storage.local.get(['lumaToc:myPromptsV1','lunaToc:promptUsageV1','chatToc:themeSettings','chatToc:sidebarPreferences']));
        assert.equal(restored['lumaToc:myPromptsV1'][0].id,'e2e-prompt');
        assert.equal(restored['lunaToc:promptUsageV1']['e2e-prompt'].usageCount,2);
        assert.deepEqual(restored['chatToc:themeSettings'],backup.data.theme);
        assert.deepEqual(restored['chatToc:sidebarPreferences'],backup.data.sidebar);
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
