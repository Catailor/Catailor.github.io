const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');const {createStudio}=require('../../tools/studio.cjs');
let server,root,base;
test.beforeAll(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-browser-'));fs.mkdirSync(path.join(root,'source/_drafts'),{recursive:true});server=createStudio({root});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(async()=>{await new Promise(r=>server.close(r));if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('studio-browser-'))fs.rmSync(root,{recursive:true,force:true});});
const RICH='#rich-editor .ProseMirror',SOURCE='#source-editor .cm-content';
async function newArticle(page){await page.goto(base);await page.locator('#empty-new').click();await expect(page.locator(RICH)).toBeVisible();await page.locator('#title').fill('测试写作');}
// Switch to the Markdown source (CodeMirror) and replace its text.
async function writeSource(page,text){if(!await page.locator(SOURCE).isVisible())await page.locator('#mode-toggle').click();await page.locator(SOURCE).fill(text);}
async function toVisual(page){await page.locator('#mode-toggle').click();await expect(page.locator(RICH)).toBeVisible();}
async function toSource(page){await page.locator('#mode-toggle').click();await expect(page.locator(SOURCE)).toBeVisible();}
async function more(page,id){await page.locator('#more-toggle').click();await page.locator(id).click();}
async function properties(page){if(await page.locator('#settings').isHidden())await page.locator('#settings-toggle').click();await expect(page.locator('#settings')).toBeVisible();}
test('Japanese IME commits once, autosaves and survives reloading',async({page})=>{
  await newArticle(page);await page.locator(RICH).click();const cdp=await page.context().newCDPSession(page);
  for(const text of ['t','た'])await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
  await cdp.send('Input.insertText',{text:'た'});
  await expect(page.locator(RICH)).toHaveText('た');await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  await page.reload();await expect(page.locator(RICH)).toHaveText('た');
});
test('the Japanese full-width slash opens the block menu and furigana renders as ruby',async({page})=>{
  await newArticle(page);await page.locator(RICH).click();const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition',{text:'・',selectionStart:1,selectionEnd:1});await cdp.send('Input.insertText',{text:'・'});
  await expect(page.locator('.milkdown-slash-menu[data-show=true]')).toBeVisible();await expect(page.locator('.milkdown-slash-menu')).toContainText('生词表');
  await page.keyboard.press('Escape');await writeSource(page,'今日は[漢字]{かんじ}を勉強した。');await expect(page.locator('#save-status')).toHaveText('已保存到本机');await toVisual(page);
  await expect(page.locator('#rich-editor ruby rt')).toHaveText('かんじ');
  await page.locator('#article-preview').click();await expect(page.frameLocator('#preview').locator('#article-container ruby rt')).toHaveText('かんじ');
});
test('long writing keeps the caret visible; modes and history remain usable',async({page})=>{
  await newArticle(page);await writeSource(page,Array.from({length:90},(_,i)=>`第 ${i} 段：今日は日本語を書きます。`).join('\n\n'));
  await toVisual(page);await page.locator(RICH).click();await page.keyboard.press('Control+End');await page.keyboard.type(' end');
  await expect.poll(()=>page.evaluate(()=>{const rect=getSelection().getRangeAt(0).getBoundingClientRect();return document.getElementById('writing-scroll').getBoundingClientRect().bottom-rect.bottom;})).toBeGreaterThan(140);
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');await more(page,'#article-history');await expect(page.locator('#history-list button').first()).toBeVisible();await page.locator('#history-list button').first().click();await page.locator('#history-restore').click();await expect(page.locator('#history-dialog')).not.toBeVisible();
  await page.locator('#article-preview').click();await expect(page.frameLocator('#preview').locator('#article-container')).toBeVisible();
});
test('visual content survives Markdown switching and preview uses site formatting',async({page})=>{
  await newArticle(page);await writeSource(page,'前<br>后\n\n公式 $x^2$。\n\n> [!TIP]\n> 提示正文');await toVisual(page);
  await expect(page.locator('#rich-editor .katex').first()).toBeVisible();await toSource(page);await expect(page.locator(SOURCE)).toContainText('$x^2$');await expect(page.locator(SOURCE)).toContainText('> [!TIP]');
  await page.locator('#article-preview').click();const frame=page.frameLocator('#preview');await expect(frame.locator('.katex')).toBeVisible();await expect(frame.locator('.study-note')).toBeVisible();await expect(frame.locator('#article-container br')).toHaveCount(1);
});
test('formulas render in the visual editor, survive editing nearby and persist after reloading',async({page})=>{
  await newArticle(page);await writeSource(page,'普通段落\n\n公式 $x^2$ 在这里\n\n末尾段落');await toVisual(page);
  await expect(page.locator('#rich-editor .katex')).toBeVisible();await page.locator(RICH).getByText('末尾段落').click();await page.keyboard.press('End');await page.keyboard.type('，继续写');
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');await page.reload();await expect(page.locator('#rich-editor .katex')).toBeVisible();
  await toSource(page);await expect(page.locator(SOURCE)).toContainText('公式 $x^2$ 在这里');await expect(page.locator(SOURCE)).toContainText('末尾段落，继续写');
});
test('image descriptions survive visual editing and appear in publication preview',async({page})=>{
  await newArticle(page);await writeSource(page,'![图片](/img/uploads/missing.png)\n\n![图片二](/img/uploads/second.png)');await toVisual(page);await more(page,'#article-images');
  await page.getByRole('textbox',{name:'图片说明',exact:true}).nth(0).fill('今天的学习笔记');await page.getByRole('textbox',{name:'图片说明',exact:true}).nth(1).fill('另一张图片的说明');await page.getByRole('button',{name:'保存配图修改'}).click();await expect(page.locator('#images-dialog')).not.toBeVisible();
  await toSource(page);await expect(page.locator(SOURCE)).toContainText('"今天的学习笔记"');await expect(page.locator(SOURCE)).toContainText('"另一张图片的说明"');
  await page.locator('#article-preview').click();await expect(page.frameLocator('#preview').locator('.article-image-caption')).toHaveText(['今天的学习笔记','另一张图片的说明']);
});
test('replacing a large PNG compresses the upload and retains the article reference',async({page})=>{
  await newArticle(page);await writeSource(page,'![图片](/img/uploads/old.png)');await more(page,'#article-images');
  const base64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=500;const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);let n=1;for(let i=0;i<data.data.length;i+=4){n=(n*1664525+1013904223)>>>0;data.data[i]=n&255;data.data[i+1]=(n>>>8)&255;data.data[i+2]=(n>>>16)&255;data.data[i+3]=255;}ctx.putImageData(data,0,0);return canvas.toDataURL('image/png').split(',')[1];});
  let release,started;const pending=new Promise(r=>release=r),uploadStarted=new Promise(r=>started=r);await page.route('**/api/upload',async route=>{started();await pending;await route.continue();});
  const bytes=Buffer.from(base64,'base64');await page.locator('#images-list input[type=file]').setInputFiles({name:'large.png',mimeType:'image/png',buffer:bytes});await uploadStarted;
  await expect(page.getByRole('button',{name:'保存配图修改'})).toBeDisabled();await expect(page.locator('.image-status')).toContainText('正在处理');release();
  await expect(page.locator('#images-list img')).toHaveAttribute('src',/\.webp$/);await page.getByRole('button',{name:'保存配图修改'}).click();await expect(page.locator('#images-dialog')).not.toBeVisible();
  await expect(page.locator(SOURCE)).toContainText('.webp');const raw=await page.locator(SOURCE).textContent();const file=raw.match(/\/img\/uploads\/[^)]+/)[0];expect(fs.statSync(path.join(root,'source',file)).size).toBeLessThan(bytes.length);
});
test('a slow history response cannot override the most recently selected version',async({page})=>{
  await newArticle(page);await writeSource(page,'最早的一段文字');await expect(page.locator('#save-status')).toHaveText('已保存到本机');await writeSource(page,'后来增加的完整正文');await expect(page.locator('#save-status')).toHaveText('已保存到本机');await more(page,'#article-history');
  let release,started;const pending=new Promise(r=>release=r),startedPromise=new Promise(r=>started=r);let first=true;
  await page.route('**/api/history-version?*',async route=>{if(first){first=false;const response=await route.fetch();started();await pending;await route.fulfill({response});}else await route.continue();});
  const choices=page.locator('#history-list button');await choices.nth(0).click();await startedPromise;await expect(page.locator('#history-restore')).toBeDisabled();await choices.nth(1).click();await expect(choices.nth(1)).toHaveAttribute('aria-current','true');const selected=await page.locator('#history-selected').textContent();
  const done=page.waitForResponse(response=>response.url().includes('/api/history-version'));release();await done;await page.evaluate(()=>new Promise(requestAnimationFrame));await expect(choices.nth(1)).toHaveAttribute('aria-current','true');await expect(page.locator('#history-selected')).toHaveText(selected);await expect(page.locator('#history-current .history-added')).not.toHaveCount(0);
});
test('private publication failures offer a fresh review without republishing automatically',async({page})=>{
  await newArticle(page);await page.route('**/api/publications',route=>route.fulfill({json:[{state:'error',updated:new Date().toISOString(),message:'测试：网络中断',items:[{id:'source/private/vault.json'}]}]}));
  let reviewed=false;await page.route('**/api/review',route=>{reviewed=route.request().postDataJSON().private===true;return route.fulfill({json:{id:'source/private/vault.json',title:'加密私人手记',summary:'测试预览',assets:[]}});});
  await page.locator('#library-toggle').click();await page.locator('#publication-history').click();await expect(page.locator('#publications-list')).toContainText('内容仍保存在本机');await page.getByText('查看失败原因',{exact:true}).click();await expect(page.locator('.publication-error')).toContainText('网络中断');await page.getByRole('button',{name:'重新检查加密手记'}).click();await expect(page.locator('#review')).toBeVisible();expect(reviewed).toBe(true);
});
test('series can be searched, created and configured for the homepage',async({page})=>{
  await newArticle(page);await page.locator('#article-series').click();await page.locator('#field-search').fill('摄影练习');await page.locator('#dialog-submit').click();await expect(page.locator('#dialog-title')).toHaveText('新建系列');await expect(page.locator('#field-title')).toHaveValue('摄影练习');
  await page.getByText('首页展示（选填）',{exact:true}).click();await page.locator('#field-homepage').selectOption('yes');await page.locator('#field-homeOrder').fill('2');await page.locator('#dialog-submit').click();
  await expect(page.locator('#article-series')).toContainText('摄影练习');const library=await(await page.request.get(base+'/api/library')).json();expect(library.series.find(s=>s.title==='摄影练习')).toMatchObject({homepage:true,homeOrder:2});
});
test('quick moments, readable link names and keyboard shortcuts work from the writing desk',async({page})=>{
  await page.goto(base);await expect(page.locator('#empty-greeting')).not.toBeEmpty();
  await page.locator('#quick-moment').click();await expect(page.locator('#title')).toHaveValue(/^碎碎念/);await expect(page.locator('#kind')).toHaveValue('moment');
  await page.locator(RICH).click();await page.keyboard.type('月亮很圆。');
  await properties(page);await page.locator('#link').fill('Evening Walk');await page.locator('#topic').click();
  await expect(page.locator('#link')).toHaveValue('evening-walk');await expect(page.locator('#link-preview')).toContainText('/evening-walk/');
  await page.keyboard.press('Control+s');await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  const file=fs.readdirSync(path.join(root,'source/_drafts')).map(name=>fs.readFileSync(path.join(root,'source/_drafts',name),'utf8')).find(text=>text.includes('月亮很圆'));
  expect(file).toContain('kind: moment');expect(file).toMatch(/permalink: \d{4}\/\d{2}\/\d{2}\/evening-walk\//);
  await page.locator(RICH).click();await page.keyboard.press('Control+/');await expect(page.locator(SOURCE)).toBeVisible();await expect(page.locator(SOURCE)).toContainText('月亮很圆。');
  await page.keyboard.press('Control+/');await expect(page.locator(RICH)).toBeVisible();
  await page.keyboard.press('Control+,');await expect(page.locator('#settings')).toBeHidden();
  await page.keyboard.press('Control+k');await expect(page.locator('#palette')).toBeVisible();await page.locator('#palette-input').fill('快捷键');await page.keyboard.press('Enter');await expect(page.locator('#shortcuts-dialog')).toBeVisible();
  await page.keyboard.press('Escape');await page.locator('#desk-back').click();await expect(page.locator('body')).toHaveAttribute('data-screen','desk');
});
