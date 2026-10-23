/**
 * Chromium end-to-end checks of the built Manifest V3 extension.
 * Requests for the mocked ChatGPT page never reach ChatGPT's servers.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {existsSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

const dist=resolve('dist');
const conversationId='luna-stage-9-e2e';
const url='https://chatgpt.com/c/'+conversationId;
const html=[
'<!doctype html><html lang="zh"><head><meta charset="UTF-8"><title>测试会话 - ChatGPT</title>',
'<style>body{margin:0;font-family:Arial}#root{display:flex;height:100vh}',
'#native-nav{width:170px;background:#eee;flex-shrink:0}',
'main{flex:1;min-width:0;display:flex;flex-direction:column;overflow:auto}',
'#thread{flex:1;overflow:auto;padding:20px}article{padding:24px}',
'#thread-bottom-container{padding:12px;border-top:1px solid #999}',
'.ProseMirror{border:1px solid #999;min-height:40px}</style></head><body>',
'<div id="root"><nav id="native-nav"><a href="/c/luna-stage-9-e2e">会话</a></nav>',
'<main id="chat-main"><div id="thread">',
'<article data-turn="user" data-testid="conversation-turn-1" data-message-id="user-1"><div data-message-author-role="user">第一条测试问题</div></article>',
'<article data-turn="assistant" data-message-id="answer-1"><h2>回答一</h2></article>',
'<article data-turn="user" data-testid="conversation-turn-2" data-message-id="user-2"><div data-message-author-role="user">第二条测试问题</div></article>',
'<article data-turn="assistant" data-message-id="answer-2"><h3>回答二</h3></article>',
'</div><div id="thread-bottom-container"><div class="ProseMirror" contenteditable="true" role="textbox" id="prompt-textarea"></div></div></main></div>',
'<script>window.addEventListener("load",()=>fetch("/backend-api/conversations/luna-stage-9-e2e?num_turns=4").catch(()=>{}))</script>',
'</body></html>'
].join('');
const items=[
  {id:'user-1',author:{role:'user'},content:{parts:['第一条测试问题']},parent:null,create_time:1},
  {id:'answer-1',author:{role:'assistant'},content:{parts:['回答一']},parent:'user-1',create_time:2},
  {id:'user-2',author:{role:'user'},content:{parts:['第二条测试问题']},parent:'answer-1',create_time:3},
  {id:'answer-2',author:{role:'assistant'},content:{parts:['回答二']},parent:'user-2',create_time:4},
];
const payload=JSON.stringify({messages:items,current_node:'answer-2',
  page_info:{has_previous_page:false,has_next_page:false}});

/** Intercept the real extension's host origin; all other HTTP traffic is denied. */
async function installFixture(context){
  await context.route('https://chatgpt.com/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(route.request().isNavigationRequest()){
      await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html});
    }else if(/^\/backend-api\/conversations\/[^/]+$/.test(p)){
      await route.fulfill({status:200,contentType:'application/json',body:payload});
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
    await page.evaluate(async()=>{await fetch('/backend-api/conversations/"+conversationId+"/?num_turns=4');});

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
