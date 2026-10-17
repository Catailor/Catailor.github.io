'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const moment=require('moment');
const {serialize,validatePublication,details,noteDetails,parseDocument}=require('../tools/studio-content.cjs');

const base='---\ntitle: 旧标题\ndate: 2026-04-05 21:30:00\ncategories: [学习笔记]\ntags: [数学]\n---\n正文';
const input=extra=>({title:'新标题',body:'正文',summary:'一句摘要',date:'2026-04-05',categories:['学习笔记'],tags:['数学'],...extra});

test('studio stores kind, topic and a readable link name in front matter',()=>{
  const data=parseDocument(serialize(base,input({kind:'study',topic:'数学基础',link:'linear-algebra'})));
  assert.equal(data.kind,'study');assert.equal(data.topic,'数学基础');assert.equal(data.permalink,'2026/04/05/linear-algebra/');
  const cleared=parseDocument(serialize(serialize(base,input({kind:'study',topic:'数学基础',link:'linear-algebra'})),input({kind:'',topic:'',link:''})));
  assert.equal(cleared.kind,undefined);assert.equal(cleared.topic,undefined);assert.equal(cleared.permalink,undefined);
  assert.throws(()=>serialize(base,input({link:'Bad Link!'})),/链接名/);
  assert.throws(()=>serialize(base,input({kind:'poem'})),/类型/);
});

test('changing the address of a published post keeps the old address as a redirect',()=>{
  const id='source/_posts/note-4996180f-5cae-47e9-b39a-195fa82c88a5.md';
  const renamed=parseDocument(serialize(base,input({id,link:'cauchy'}),base,{permalink:':year/:month/:day/:title/'}));
  assert.deepEqual(renamed.redirect_from,['/2026/04/05/note-4996180f-5cae-47e9-b39a-195fa82c88a5/']);
  const published='---\n'+serialize(base,input({id,link:'cauchy'}),base,{permalink:':year/:month/:day/:title/'}).replace(/^---\n/,'');
  const back=parseDocument(serialize(published,input({id,link:''}),published,{permalink:':year/:month/:day/:title/'}));
  assert.deepEqual(back.redirect_from,['/2026/04/05/cauchy/'],'returning to the original address drops it from redirects and records the abandoned one');
  const draft=parseDocument(serialize(base,input({id,link:'cauchy'}),null,{}));
  assert.equal(draft.redirect_from,undefined,'unpublished posts never need redirects');
});

test('studio details expose the note fields used by the settings drawer',()=>{
  const text=serialize(base,input({kind:'life',topic:'散步',link:'evening-walk'}));
  const root=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'moonlight-'));fs.mkdirSync(path.join(root,'source/_posts'),{recursive:true});
  fs.writeFileSync(path.join(root,'source/_posts/x.md'),text);
  try{const info=details(root,'source/_posts/x.md');assert.equal(info.kind,'life');assert.equal(info.topic,'散步');assert.equal(info.link,'evening-walk');}
  finally{fs.rmSync(root,{recursive:true,force:true});}
  assert.deepEqual(noteDetails({permalink:'custom/path/'}),{link:'',customPermalink:true,kind:'',topic:''});
});

test('publication review offers gentle tips without blocking',()=>{
  const bare='---\ntitle: 小记\ndate: 2026-04-05 10:00:00\n---\n今天学了一点东西。';
  const review=validatePublication(bare,'source/_posts/note-4996180f-5cae-47e9-b39a-195fa82c88a5.md');
  assert.equal(review.tips.length,3);
  const tidy=validatePublication('---\ntitle: 小记\ndescription: 摘要\ncategories: [日常]\npermalink: 2026/04/05/walk/\n---\n今天学了一点东西。','source/_posts/note-4996180f-5cae-47e9-b39a-195fa82c88a5.md');
  assert.deepEqual(tidy.tips,[]);
});

function runFeeds(posts){
  let generator;const filename=path.resolve('scripts/feeds.js');
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{require:createRequire(filename),URL,hexo:{extend:{generator:{register(_,fn){generator=fn;}}}}});
  const list=arr=>({toArray:()=>arr});
  const locals={posts:{sort:()=>list(posts)},pages:list([{path:'about/index.html',layout:'page',date:moment('2026-04-01')},{path:'private/index.html',layout:'page',date:moment('2026-04-01')}])};
  return generator.call({config:{url:'https://catailor.github.io',title:'月下手记',description:'d',language:'zh-CN'}},locals);
}
test('feeds, sitemap, robots and redirect pages are generated without plugins',()=>{
  const post={title:'柯西 & 不等式',path:'2026/04/05/cauchy/',description:'摘要',content:'<p>正文</p>',date:moment('2026-04-05T12:00:00Z'),updated:moment('2026-04-06T12:00:00Z'),categories:{toArray:()=>[{name:'学习笔记'}]},tags:{toArray:()=>[{name:'数学'}]},redirect_from:['/2026/04/05/note-abc/','../escape/']};
  const files=Object.fromEntries(runFeeds([post,{...post,title:'草稿',published:false}]).map(f=>[f.path,f.data]));
  assert.match(files['atom.xml'],/<title>柯西 &amp; 不等式<\/title>/);assert.doesNotMatch(files['atom.xml'],/草稿/);
  assert.match(files['atom.xml'],/https:\/\/catailor\.github\.io\/2026\/04\/05\/cauchy\//);
  assert.match(files['sitemap.xml'],/<loc>https:\/\/catailor\.github\.io\/about\/<\/loc>/);assert.doesNotMatch(files['sitemap.xml'],/private/);
  assert.match(files['robots.txt'],/Disallow: \/private\//);assert.match(files['robots.txt'],/Sitemap: https:\/\/catailor\.github\.io\/sitemap\.xml/);
  const redirect=files['2026/04/05/note-abc/index.html'];assert.ok(redirect);assert.match(redirect,/url=\/2026\/04\/05\/cauchy\//);
  assert.ok(!Object.keys(files).some(name=>name.includes('escape')),'unsafe redirect sources are ignored');
});
