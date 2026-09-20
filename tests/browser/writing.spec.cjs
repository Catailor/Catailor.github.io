const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');const {createStudio}=require('../../tools/studio.cjs');
let server,root,base;
test.beforeAll(async()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-browser-'));fs.mkdirSync(path.join(root,'source/_drafts'),{recursive:true});server=createStudio({root});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;});
test.afterAll(async()=>{await new Promise(r=>server.close(r));if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('studio-browser-'))fs.rmSync(root,{recursive:true,force:true});});
async function newArticle(page){await page.goto(base);await page.locator('#empty-new').click();await page.locator('#title').fill('测试写作');}
test('Japanese IME commits once, autosaves and survives reloading',async({page})=>{
  await newArticle(page);await page.locator('.toastui-editor-ww-container .ProseMirror').click();const cdp=await page.context().newCDPSession(page);
  for(const text of ['t','た'])await cdp.send('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});
  await cdp.send('Input.insertText',{text:'た'});
  await expect(page.locator('.toastui-editor-ww-container .ProseMirror')).toHaveText('た');await expect(page.locator('#save-status')).toHaveText('已保存到本机');
  await page.reload();await expect(page.locator('.toastui-editor-ww-container .ProseMirror')).toHaveText('た');
});
test('long writing keeps the toolbar and caret visible; modes and history remain usable',async({page})=>{
  await newArticle(page);await page.locator('#mode-toggle').click();const source=page.locator('#source-editor');
  await source.fill(Array.from({length:90},(_,i)=>`第 ${i} 段：今日は日本語を書きます。`).join('\n\n'));
  await page.locator('#mode-toggle').click();const body=page.locator('.toastui-editor-ww-container .ProseMirror');await body.click();await page.keyboard.press('Control+End');await page.keyboard.type(' end');
  await expect.poll(()=>page.evaluate(()=>{const rect=getSelection().getRangeAt(0).getBoundingClientRect();return document.getElementById('writing-scroll').getBoundingClientRect().bottom-rect.bottom;})).toBeGreaterThan(140);
  const toolbar=page.locator('.toastui-editor-defaultUI-toolbar');await expect(toolbar).toBeInViewport();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');await page.locator('#settings-toggle').click();await page.locator('#article-history').click();await expect(page.locator('#history-list button').first()).toBeVisible();await page.locator('#history-list button').first().click();await page.locator('#history-restore').click();await expect(page.locator('#history-dialog')).not.toBeVisible();
  await page.locator('#settings-toggle').click();await page.locator('#article-preview').click();await expect(page.frameLocator('#preview').locator('#article-container')).toBeVisible();
});
test('visual content survives Markdown switching and preview uses site formatting',async({page})=>{
  await newArticle(page);await page.locator('#mode-toggle').click();await page.locator('#source-editor').fill('前<br>后\n\n公式 $x^2$。\n\n> [!TIP]\n> 提示正文');await page.locator('#mode-toggle').click();
  await expect(page.locator('#rich-editor')).toBeVisible();await page.locator('#mode-toggle').click();await expect(page.locator('#source-editor')).toHaveValue(/\$x\^2\$/);
  await page.locator('#settings-toggle').click();await page.locator('#article-preview').click();const frame=page.frameLocator('#preview');await expect(frame.locator('.katex')).toBeVisible();await expect(frame.locator('.study-note')).toBeVisible();await expect(frame.locator('#article-container br')).toHaveCount(1);
});
test('protected formulas render inline, can be edited and persist after reloading',async({page})=>{
  await newArticle(page);await page.locator('#mode-toggle').click();await page.locator('#source-editor').fill('普通段落\n\n$x^2$\n\n末尾段落');await page.locator('#mode-toggle').click();
  await expect(page.locator('.studio-special-preview .katex')).toBeVisible();await page.getByRole('button',{name:'编辑这一块',exact:true}).click();
  const code=page.locator('.studio-special-block code');await code.click();await page.keyboard.press('Home');await page.keyboard.press('Shift+End');await page.keyboard.insertText('$y^3$');await page.getByRole('button',{name:'完成编辑',exact:true}).click();
  await expect(page.locator('#save-status')).toHaveText('已保存到本机');await page.reload();await expect(page.locator('.studio-special-preview')).toContainText('y');await page.locator('#mode-toggle').click();await expect(page.locator('#source-editor')).toHaveValue(/\$y\^3\$/);
});
test('image descriptions survive visual editing and appear in publication preview',async({page})=>{
  await newArticle(page);await page.locator('#mode-toggle').click();await page.locator('#source-editor').fill('![图片](/img/uploads/missing.png)');await page.locator('#mode-toggle').click();await page.locator('#settings-toggle').click();await page.locator('#article-images').click();
  await page.getByRole('textbox',{name:'图片说明',exact:true}).fill('今天的学习笔记');await page.getByRole('button',{name:'保存这张图片的修改'}).click();await page.getByRole('button',{name:'关闭文章配图'}).click();
  await page.locator('#mode-toggle').click();await expect(page.locator('#source-editor')).toHaveValue(/"今天的学习笔记"/);
  await page.locator('#article-preview').click();await expect(page.frameLocator('#preview').locator('.article-image-caption')).toHaveText('今天的学习笔记');
});
test('replacing a large PNG compresses the upload and retains the article reference',async({page})=>{
  await newArticle(page);await page.locator('#mode-toggle').click();await page.locator('#source-editor').fill('![图片](/img/uploads/old.png)');await page.locator('#settings-toggle').click();await page.locator('#article-images').click();
  const base64=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=2200;canvas.height=500;const ctx=canvas.getContext('2d'),data=ctx.createImageData(canvas.width,canvas.height);let n=1;for(let i=0;i<data.data.length;i+=4){n=(n*1664525+1013904223)>>>0;data.data[i]=n&255;data.data[i+1]=(n>>>8)&255;data.data[i+2]=(n>>>16)&255;data.data[i+3]=255;}ctx.putImageData(data,0,0);return canvas.toDataURL('image/png').split(',')[1];});
  const bytes=Buffer.from(base64,'base64');await page.locator('#images-list input[type=file]').setInputFiles({name:'large.png',mimeType:'image/png',buffer:bytes});
  await expect(page.locator('#images-list img')).toHaveAttribute('src',/\.webp$/);await page.getByRole('button',{name:'保存这张图片的修改'}).click();await page.getByRole('button',{name:'关闭文章配图'}).click();
  const raw=await page.locator('#source-editor').inputValue();expect(raw).toMatch(/\.webp/);const file=raw.match(/\/img\/uploads\/[^)]+/)[0];expect(fs.statSync(path.join(root,'source',file)).size).toBeLessThan(bytes.length);
});
test('series can be searched, created and configured for the homepage',async({page})=>{
  await newArticle(page);await page.locator('#article-series').click();await page.locator('#field-search').fill('摄影练习');await page.locator('#dialog-submit').click();await expect(page.locator('#dialog-title')).toHaveText('新建系列');await expect(page.locator('#field-title')).toHaveValue('摄影练习');
  await page.getByText('首页展示（选填）',{exact:true}).click();await page.locator('#field-homepage').selectOption('yes');await page.locator('#field-homeOrder').fill('2');await page.locator('#dialog-submit').click();
  await expect(page.locator('#article-series')).toContainText('摄影练习');const library=await(await page.request.get(base+'/api/library')).json();expect(library.series.find(s=>s.title==='摄影练习')).toMatchObject({homepage:true,homeOrder:2});
});
