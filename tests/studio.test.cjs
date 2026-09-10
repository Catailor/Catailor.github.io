'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { once } = require('node:events');
const { safePath, revision, serialize, validatePublication, selectedAssets, details } = require('../tools/studio-content.cjs');
const { createStudio } = require('../tools/studio.cjs');
const { publish, run } = require('../tools/studio-publish.cjs');
const { vocabulary, wordbook } = require('../lib/notebook');
const markdown = require('markdown-it')();
const sample = '---\nlayout: post\ntitle: 今日学习\ndate: 2026-09-10 09:20:00\npermalink: stable-link/\ncategories: [日语学习]\n---\n\n学习了新的表达。\n';
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-studio-test-'));
function cleanup(dir) { if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('moonlit-studio-test-')) throw new Error('Unexpected test path'); fs.rmSync(dir, { recursive:true, force:true }); }
function write(root, file, content) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive:true }); fs.writeFileSync(path.join(root, file), content); }
test('draft publication rejects empty templates and preserves stable metadata when edited', () => {
  assert.throws(() => validatePublication(fs.readFileSync('scaffolds/japanese.md','utf8').replace('{{ title }}','测试').replace('{{ date }}','2026-09-10')));
  assert.throws(() => validatePublication(sample + '\n- 学习时长：\n'));
  assert.throws(() => validatePublication(sample.replace('layout: post','private: true')));
  assert.equal(validatePublication(sample).category, '日语学习');
  const result = serialize(sample, { title:'更好的标题', date:'2026-09-10', summary:'新的摘要', body:'记录新的理解。' });
  assert.match(result, /permalink: stable-link\//); assert.match(result, /09:20:00/); assert.match(result, /studio_edited: true/);
  assert.throws(() => serialize(sample, { title:'a', date:'2026-02-30', summary:'', body:'body' }));
});
test('writer scopes paths and uploaded assets, including Unicode filenames', () => {
  const root = temporary();
  try {
    assert.equal(safePath(root, 'source/_posts/科研.md'), path.join(root, 'source/_posts/科研.md'));
    for (const id of ['../secret', 'source/_posts/../private/a.md', 'source/_posts/a.md/../../a', 'source/private/plain.md', 'source/_posts/a.md:ads', 'source/_posts/a\\b.md']) assert.throws(() => safePath(root, id));
    write(root, 'source/img/uploads/one.png', 'image'); write(root, 'source/img/uploads/other.png', 'other');
    assert.deepEqual(selectedAssets(root, '![图](/img/uploads/one.png)'), ['source/img/uploads/one.png']);
  } finally { cleanup(root); }
});
test('wordbook collects only complete vocabulary rows and merges repeated words with source dates', () => {
  const html = markdown.render('| 单词 | 读音（假名） | 中文意思 | 例句与用法 |\n|---|---|---|---|\n| 猫 | ねこ | 猫 | 猫がいます。 |\n| 空 | | | |\n');
  const words = vocabulary(html); assert.equal(words.length, 1);
  const result = wordbook([{ vocabulary:words, url:'/day2/',date:'2026-09-11',title:'第二天' }, { vocabulary:words, url:'/day1/',date:'2026-09-10',title:'第一天' }]);
  assert.equal(result.length,1); assert.equal(result[0].sources.length,2); assert.deepEqual(result[0].meanings,['猫']);
});
test('daily column is bounded to twenty entries and links to month and next pages', () => {
  const vm = require('node:vm'), { createRequire } = require('node:module'); let generate;
  const script = path.resolve('scripts/notebook.js');
  vm.runInNewContext(fs.readFileSync(script, 'utf8'), { require:createRequire(script), hexo:{ extend:{ filter:{register(){}}, helper:{register(){}}, generator:{register(name, fn){generate=fn;}} } } });
  const posts = Array.from({length:31},(_,i)=>({ source:`_posts/day-${i}.md`,title:`日记 ${i}`,path:`days/${i}/`,content:'<p>真实学习记录</p>',date:{format(){return `2026-09-${String(i%30+1).padStart(2,'0')}`;}},categories:{toArray:()=>[{name:'日语学习'}]},tags:{toArray:()=>[]} }));
  const routes=generate({data:{notebook:{series:[{id:'japanese',title:'日语日记',description:'学习',category:'日语学习',order:'newest'}]}},posts:{sort(){return this;},toArray:()=>posts}});
  const first=routes.find(r=>r.path==='topics/japanese/index.html');
  assert.equal((first.data.content.match(/<li>/g)||[]).length,20);
  assert(first.data.content.includes('/topics/japanese/page/2/'));
  assert(routes.some(r=>r.path==='topics/japanese/2026-09/index.html'));
  assert.equal((routes.find(r=>r.path==='topics/japanese/page/2/index.html').data.content.match(/<li>/g)||[]).length,11);
});
test('studio rejects cross-origin and stale writes; draft saving preserves other files', async () => {
  const root = temporary(); write(root,'source/_drafts/one.md',sample); write(root,'source/_posts/untouched.md',sample);
  const server = createStudio({root}); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/api/session',{headers:{Origin:'https://evil.example'}})).status,403);
    const {token} = await (await fetch(base+'/api/session')).json();
    const headers = {Origin:base,'Content-Type':'application/json','X-Studio-Token':token};
    const initial = details(root,'source/_drafts/one.md');
    const input = {...initial,title:'改好的标题',body:'这是一篇草稿。'};
    assert.equal((await fetch(base+'/api/save',{method:'POST',headers:{...headers,'X-Studio-Token':'wrong'},body:JSON.stringify(input)})).status,403);
    assert.equal((await fetch(base+'/api/save',{method:'POST',headers,body:JSON.stringify(input)})).status,200);
    assert.equal((await fetch(base+'/api/save',{method:'POST',headers,body:JSON.stringify(input)})).status,409);
    assert.equal(fs.readFileSync(path.join(root,'source/_posts/untouched.md'),'utf8'),sample);
    assert.equal(fs.readdirSync(path.join(root,'.studio-backups')).length,1);
  } finally { await new Promise(resolve=>server.close(resolve)); cleanup(root); }
});
test('selected publication uses an isolated checkout and leaves unfinished local work untouched', async () => {
  const directory=temporary(), root=path.join(directory,'project'), remote=path.join(directory,'remote.git'); fs.mkdirSync(root);
  try {
    await run('git',['init','--bare',remote],directory); await run('git',['init','-b','main'],root);
    await run('git',['config','user.name','Notebook Test'],root); await run('git',['config','user.email','test@example.invalid'],root);
    write(root,'.gitignore','.studio/\nnode_modules/\nsource/_drafts/\n');
    write(root,'source/_posts/existing.md',sample); write(root,'tools/build.cjs',"require('node:fs').writeFileSync('build-proof.txt','ok')");
    fs.mkdirSync(path.join(root,'node_modules'));
    await run('git',['add','.'],root); await run('git',['commit','-m','Initial'],root); await run('git',['remote','add','origin',remote],root); await run('git',['push','-u','origin','main'],root);
    write(root,'source/_posts/existing.md',sample+'UNFINISHED_LOCAL_EDIT');
    write(root,'source/_posts/untracked.md','UNTRACKED_USER_NOTE');
    write(root,'source/_drafts/one.md',sample); write(root,'source/_drafts/two.md',sample+'OTHER_DRAFT');
    const states=[]; await publish(root,[{id:'source/_drafts/one.md',revision:revision(sample)}],state=>states.push(state));
    assert.equal(states.at(-1).state,'deploying');
    assert(fs.existsSync(path.join(root,'source/_posts/one.md'))); assert(!fs.existsSync(path.join(root,'source/_drafts/one.md')));
    assert.match(fs.readFileSync(path.join(root,'source/_posts/existing.md'),'utf8'),/UNFINISHED_LOCAL_EDIT/);
    assert.equal(fs.readFileSync(path.join(root,'source/_posts/untracked.md'),'utf8'),'UNTRACKED_USER_NOTE');
    assert.match(fs.readFileSync(path.join(root,'source/_drafts/two.md'),'utf8'),/OTHER_DRAFT/);
    const remoteFiles=await run('git',['--git-dir='+remote,'ls-tree','-r','--name-only','main'],root);
    assert(remoteFiles.includes('source/_posts/one.md')); assert(!remoteFiles.includes('untracked.md')); assert(!remoteFiles.includes('two.md'));
    assert.equal(await run('git',['diff','--cached','--name-only'],root),'');
  } finally { cleanup(directory); }
});
