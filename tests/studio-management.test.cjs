'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {once}=require('node:events'),yaml=require('js-yaml');
const {createStudio}=require('../tools/studio.cjs');
const {publish,run,seriesChanges}=require('../tools/studio-publish.cjs');
const {library,saveLibrary,resolveId}=require('../tools/studio-library.cjs');
const {details,revision}=require('../tools/studio-content.cjs');
const {trash,restore,listTrash}=require('../tools/studio-trash.cjs');
const sample='---\ntitle: 测试文章\ndate: 2026-09-12 12:00:00\n---\n\n这是需要保留的正文。\n';
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'studio-management-'));}
function clean(root){assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('studio-management-'));fs.rmSync(root,{recursive:true,force:true});}
function write(root,id,value){const f=path.join(root,id);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);}
test('trash validates the whole selection, preserves bytes and restores membership without overwriting another draft',()=>{
  const root=temporary();try{
    write(root,'source/_drafts/one.md',sample);write(root,'source/_drafts/two.md',sample+'第二篇');
    const c=library(root);c.series.push({id:'study',title:'学习',description:'',posts:['one.md','two.md']});saveLibrary(root,c);
    const one=details(root,'source/_drafts/one.md'),two=details(root,'source/_drafts/two.md');
    assert.throws(()=>trash(root,[one,{...two,revision:'stale'}]));assert(fs.existsSync(path.join(root,one.id)));assert.equal(listTrash(root).length,0);
    const [entry]=trash(root,[one]);assert(!fs.existsSync(path.join(root,one.id)));assert.deepEqual(library(root).series[0].posts,['two.md']);
    write(root,one.id,sample+'OTHER WINDOW');assert.throws(()=>restore(root,entry.key));assert.equal(listTrash(root).length,1);
    fs.unlinkSync(path.join(root,one.id));restore(root,entry.key);assert.equal(fs.readFileSync(path.join(root,one.id),'utf8'),sample);assert.deepEqual(library(root).series[0].posts,['one.md','two.md']);assert.equal(listTrash(root).length,0);
    assert.throws(()=>restore(root,'../../private'));
  }finally{clean(root);}
});
test('new reuses untouched empty sheets, discards only untouched sheets, and protects untitled writing',async()=>{
  const root=temporary(),server=createStudio({root});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {token}=await(await fetch(base+'/api/session')).json(),headers={Origin:base,'Content-Type':'application/json','X-Studio-Token':token};
    const api=async(route,data)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
    const one=await api('new',{});assert.equal((await api('new',{})).id,one.id);
    const saved=await api('save',{...one,body:'没有标题也要保留这段话。'});assert.equal((await api('discard-empty',saved)).discarded,false);
    const empty=await api('new',{});assert.notEqual(empty.id,one.id);assert.equal((await api('discard-empty',{...empty,revision:'old'})).discarded,false);assert.equal((await api('discard-empty',empty)).discarded,true);
    const templated=await api('new',{template:'daily'});assert.equal((await api('discard-empty',templated)).discarded,false);
    assert.equal(fs.readFileSync(path.join(root,one.id),'utf8').includes('没有标题也要保留'),true);
    assert.equal((await fetch(base+'/api/trash',{method:'POST',headers:{...headers,'X-Studio-Token':'wrong'},body:JSON.stringify({items:[saved]})})).status,403);
  }finally{await new Promise(r=>server.close(r));clean(root);}
});
test('withdrawal removes only the selected live post and series references, preserves concurrent writing, and can be republished',async()=>{
  const dir=temporary(),root=path.join(dir,'project'),remote=path.join(dir,'remote.git');fs.mkdirSync(root);
  try{
    await run('git',['init','--bare',remote],dir);await run('git',['init','-b','main'],root);await run('git',['config','user.name','Studio QA'],root);await run('git',['config','user.email','qa@example.invalid'],root);
    write(root,'.gitignore','.studio/\nnode_modules\nsource/_drafts/\n');write(root,'source/_posts/one.md',sample);write(root,'source/_posts/two.md',sample+'保留');
    write(root,'source/_data/notebook.yml',yaml.dump({series:[{id:'study',title:'学习',description:'',posts:['one.md','two.md']}],related:{'one.md':['two.md'],'two.md':['one.md']}}));
    write(root,'tools/build.cjs',"const fs=require('fs'),c=require('js-yaml').load(fs.readFileSync('source/_data/notebook.yml','utf8'));for(const s of c.series)for(const p of s.posts)if(!fs.existsSync('source/_posts/'+p))throw Error('Dangling series reference');");
    fs.symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
    await run('git',['add','.'],root);await run('git',['commit','-m','Initial'],root);await run('git',['remote','add','origin',remote],root);await run('git',['push','-u','origin','main'],root);
    assert.throws(()=>trash(root,[details(root,'source/_posts/one.md')]));
    const collection=library(root);collection.series[0].title='新的系列名';saveLibrary(root,collection);
    const changes=await seriesChanges(root,collection,[{id:'source/_posts/one.md',action:'withdraw'}]);assert(changes.some(s=>s.includes('改名')));assert(changes.some(s=>s.includes('1 篇')));
    write(root,'source/_posts/two.md',sample+'UNPUBLISHED_OTHER');write(root,'source/_posts/untracked.md',sample+'UNTRACKED');
    await publish(root,[{id:'source/_posts/one.md',revision:revision(sample),action:'withdraw'}],state=>{if(state.state==='building')write(root,'source/_posts/one.md',sample+'EDIT_DURING_WITHDRAW');},collection);
    const files=await run('git',['--git-dir='+remote,'ls-tree','-r','--name-only','main'],root);assert(!files.includes('source/_posts/one.md'));assert(files.includes('source/_posts/two.md'));assert(!files.includes('untracked.md'));
    assert.match(fs.readFileSync(path.join(root,'source/_drafts/one.md'),'utf8'),/EDIT_DURING_WITHDRAW/);assert.equal(resolveId(root,'source/_posts/one.md'),'source/_drafts/one.md');
    assert.match(fs.readFileSync(path.join(root,'source/_posts/two.md'),'utf8'),/UNPUBLISHED_OTHER/);
    const remoteConfig=yaml.load(await run('git',['--git-dir='+remote,'show','main:source/_data/notebook.yml'],root));assert(!remoteConfig.related['one.md']);assert.deepEqual(remoteConfig.related['two.md'],[]);
    const config=yaml.load(await run('git',['--git-dir='+remote,'show','main:source/_data/notebook.yml'],root));assert.deepEqual(config.series[0].posts,['two.md']);assert.equal(await run('git',['diff','--cached','--name-only'],root),'');
    await publish(root,[details(root,'source/_drafts/one.md')],()=>{},library(root));
    assert.match(await run('git',['--git-dir='+remote,'show','main:source/_posts/one.md'],root),/EDIT_DURING_WITHDRAW/);
  }finally{const link=path.join(root,'node_modules');if(fs.existsSync(link)&&fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);clean(dir);}
});
