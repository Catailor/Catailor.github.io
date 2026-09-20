'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {md,renderArticle}=require('../lib/article-renderer.cjs');
test('article rendering supports hard breaks, formulas, footnotes and study notes consistently',()=>{
  const body='## 标题\n\n前<br>后\n另一行\n\n| 词语 | 意思 |\n|---|---|\n| 猫 | 猫 |\n\n$x^2$\n\n> [!TIP]\n> 内容\n\n注释[^1]\n\n[^1]: 解释';
  const html=renderArticle(body);assert.match(html,/<br>/);assert.match(html,/<table>/);assert.match(html,/class="katex"/);assert.match(html,/study-note--tip/);assert.match(html,/footnote/);assert.match(html,/id="标题"/);
  assert.equal(require('../tools/studio-content.cjs').md,md);
});
test('visual editing preserves protected content after edits, including definitions and fenced code',async()=>{
  const {prepareVisualContent}=await import('../tools/studio/visual-content.mjs');
  for(const body of ['普通 $5，价格 $10。','前<br>后','公式 $x^2$。','<div>内容</div>','[链接][a]\n\n[a]: https://example.com','```html\n<div>原文</div>\n```']){
    const content=prepareVisualContent(body);assert.equal(content.restore(content.markdown+'\n\n新增'),body+'\n\n新增');
  }
});
test('image captions are escaped and broken local images are reported before publishing',()=>{
  const html=renderArticle('![图](/img/no-such-file.png "学习记录")');assert.match(html,/article-image-caption/);assert.match(html,/学习记录/);
  const warnings=require('../tools/studio-content.cjs').imageWarnings(process.cwd(),'![图](/img/no-such-file.png)');assert.equal(warnings.length,1);
});
test('image management excludes examples in code blocks and keeps exact source offsets',async()=>{
  const {scanImages}=await import('../tools/studio/visual-content.mjs');const source='~~~md\n![示例](/fake.png)\n~~~\n\n`![行内](/fake.png)`\n\n![实图](/real.png "说明")';const images=scanImages(source);assert.equal(images.length,1);assert.equal(images[0].url,'/real.png');assert.equal(source.slice(images[0].start,images[0].end),'![实图](/real.png "说明")');
});
test('homepage series selection honors visibility, order and latest three published entries',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),{createRequire}=require('node:module'),path=require('node:path');const helpers={};
  const filename=path.resolve('scripts/moonlit.js');vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:createRequire(filename),hexo:{extend:{filter:{register(){}},helper:{register(name,fn){helpers[name]=fn;}}}}});
  const result=helpers.moonlit_home_series.call({site:{data:{notebook:{series:[{id:'hidden',homepage:false},{id:'later',homepage:true,homeOrder:9,posts:['a.md']},{id:'first',homepage:true,homeOrder:1,posts:['a.md','b.md','c.md','d.md']}]}}}},['a','b','c','d'].map((name,i)=>({file:name+'.md',date:'2026.09.'+(20+i)})));
  assert.equal(result.length,2);assert.equal(result[0].id,'first');assert.equal(result[0].entries.length,3);assert.equal(result[0].entries[0].file,'d.md');
});
