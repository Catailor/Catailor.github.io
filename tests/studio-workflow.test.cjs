'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {once}=require('node:events'),yaml=require('js-yaml');
const {createStudio}=require('../tools/studio.cjs');
const {publish,run}=require('../tools/studio-publish.cjs');
const {library,publicConfig,posts,resolveId}=require('../tools/studio-library.cjs');
const {details,revision}=require('../tools/studio-content.cjs');
const sample='---\ntitle: First\ndate: 2026-09-12 12:00:00\n---\n\nThe original article.\n';
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'studio-workflow-'));}
function clean(root){assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('studio-workflow-'));fs.rmSync(root,{recursive:true,force:true});}
function write(root,id,value){const f=path.join(root,id);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);}
test('series and templates are managed without filenames; concurrent editors cannot overwrite the library',async()=>{
  const root=temporary();const server=createStudio({root,publisher:async()=>{}});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {token}=await(await fetch(base+'/api/session')).json();
    const api=async(route,data)=>{const r=await fetch(base+'/api/'+route,data?{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(data)}:{});return {status:r.status,data:await r.json()};};
    let collection=(await api('library')).data;assert.equal(collection.series.length,0);
    collection.series.push({id:'reading',title:'读书',description:'随读随记',favorite:true,posts:[]});
    const old=structuredClone(collection);collection=(await api('library',collection)).data;assert.equal((await api('library',old)).status,409);
    const first=(await api('new',{series:'reading'})).data;assert.equal(first.title,'');assert.equal(first.body.trim(),'');
    const second=(await api('new',{series:'reading',template:'daily'})).data;assert.match(second.body,/今天/);
    collection=(await api('library')).data;assert.deepEqual(collection.series[0].posts,[path.basename(first.id),path.basename(second.id)]);
    collection.series[0].posts.reverse();collection.templates.push({id:'custom',title:'书摘',body:'## 摘录\n\n自己的模板。',favorite:true});collection=(await api('library',collection)).data;
    const third=(await api('new',{template:'custom'})).data;assert.match(third.body,/自己的模板/);
    const exported=yaml.load(publicConfig('about:\n  intro: untouched\n',collection,new Set([path.basename(first.id)])));
    assert.deepEqual(exported.series[0].posts,[path.basename(first.id)]);assert.equal(exported.about.intro,'untouched');assert(!exported.templates);
    collection.series[0].posts=[];assert.equal((await api('library',collection)).status,200);assert(fs.existsSync(path.join(root,first.id)));
    assert.equal((await api('new',{series:'nonexistent'})).status,400);
  }finally{await new Promise(r=>server.close(r));clean(root);}
});
test('publishing does not block autosave, new articles, or series editing',async()=>{
  const root=temporary();write(root,'source/_drafts/one.md',sample);let finish;
  const server=createStudio({root,publisher:()=>new Promise(r=>{finish=r;})});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {token}=await(await fetch(base+'/api/session')).json(),headers={Origin:base,'Content-Type':'application/json','X-Studio-Token':token};
    const post=(route,data)=>fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(data)});
    assert.equal((await post('publish',{items:[{id:'source/_drafts/one.md',revision:revision(sample)}]})).status,202);
    assert.equal((await post('save',{...details(root,'source/_drafts/one.md'),body:'I can continue writing.'})).status,200);
    assert.equal((await post('new',{})).status,200);
    assert.equal((await post('library',library(root))).status,200);
    assert.equal((await post('publish',{items:[{id:'source/_drafts/one.md',revision:revision(sample)}]})).status,409);
  }finally{finish?.();await new Promise(r=>server.close(r));clean(root);}
});
test('publication freezes one article and series; later local edits survive draft promotion and stale-id saves',async()=>{
  const dir=temporary(),root=path.join(dir,'project'),remote=path.join(dir,'remote.git');fs.mkdirSync(root);
  try{
    await run('git',['init','--bare',remote],dir);await run('git',['init','-b','main'],root);await run('git',['config','user.name','Studio QA'],root);await run('git',['config','user.email','qa@example.invalid'],root);
    write(root,'.gitignore','.studio/\nnode_modules/\nsource/_drafts/\n');write(root,'source/_posts/old.md',sample);write(root,'source/_data/notebook.yml','about:\n  intro: preserve\nseries: []\n');write(root,'tools/build.cjs',"const c=require('js-yaml').load(require('fs').readFileSync('source/_data/notebook.yml','utf8'));if(c.series[0].posts.length!==1)throw Error('Draft leaked');");
    fs.symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
    await run('git',['add','.'],root);await run('git',['commit','-m','Initial'],root);await run('git',['remote','add','origin',remote],root);await run('git',['push','-u','origin','main'],root);
    write(root,'source/_drafts/one.md',sample);write(root,'source/_drafts/two.md',sample+'PRIVATE_LOCAL_DRAFT');write(root,'source/_posts/untracked.md',sample+'UNTRACKED');
    write(root,'source/_data/notebook.yml','about:\n  intro: LOCAL_UNPUBLISHED_SETTING\nseries: []\n');
    const snapshot={series:[{id:'study',title:'学习',description:'测试',posts:['two.md','one.md','untracked.md']}],templates:[]};let changed=false;
    await publish(root,[{id:'source/_drafts/one.md',revision:revision(sample)}],state=>{if(state.state==='building'&&!changed){changed=true;write(root,'source/_drafts/one.md',sample+'EDIT_DURING_BUILD');snapshot.series[0].title='Later series name';}},snapshot);
    assert.equal(await run('git',['--git-dir='+remote,'show','main:source/_posts/one.md'],root),sample.trim());
    const config=yaml.load(await run('git',['--git-dir='+remote,'show','main:source/_data/notebook.yml'],root));assert.equal(config.series[0].title,'学习');assert.deepEqual(config.series[0].posts,['one.md']);assert.equal(config.about.intro,'preserve');
    assert.match(fs.readFileSync(path.join(root,'source/_posts/one.md'),'utf8'),/EDIT_DURING_BUILD/);assert(fs.existsSync(path.join(root,'source/_drafts/two.md')));assert(!fs.existsSync(path.join(root,'source/_drafts/one.md')));
    assert.equal(resolveId(root,'source/_drafts/one.md'),'source/_posts/one.md');assert.equal(posts(root).find(p=>p.id.endsWith('/one.md')).status,'changed');assert.equal(posts(root).find(p=>p.id.endsWith('/untracked.md')).status,'draft');
    assert.equal(await run('git',['diff','--cached','--name-only'],root),'');
    assert.equal(yaml.load(fs.readFileSync(path.join(root,'source/_data/notebook.yml'),'utf8')).about.intro,'LOCAL_UNPUBLISHED_SETTING');
  }finally{const link=path.join(root,'node_modules');if(fs.existsSync(link)&&fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);clean(dir);}
});
