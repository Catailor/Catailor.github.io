'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {once}=require('node:events'),matter=require('hexo-front-matter'),yaml=require('js-yaml');
const taxonomy=require('../lib/studio-taxonomy');
const {details,serialize,updateTaxonomy,revision}=require('../tools/studio-content.cjs');
const {library,saveLibrary}=require('../tools/studio-library.cjs');
const {createStudio}=require('../tools/studio.cjs');
const {applyBatch,undoBatch}=require('../tools/studio-taxonomy.cjs');
const {publish,publishedCollection,run}=require('../tools/studio-publish.cjs');
const {trash,restore}=require('../tools/studio-trash.cjs');
const sample='---\ntitle: 学习记录\ndate: 2026-09-12 12:00:00\npermalink: stable/\ncategories: [学习, 日语]\ntags: [听力]\n---\n\n正文与公式 $x^2$ 必须完整保留。\n';
function temporary(){return fs.mkdtempSync(path.join(os.tmpdir(),'studio-taxonomy-'));}
function clean(root){assert.equal(path.dirname(root),os.tmpdir());assert(path.basename(root).startsWith('studio-taxonomy-'));fs.rmSync(root,{recursive:true,force:true});}
function write(root,id,value){const f=path.join(root,id);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,value);}
const study=()=>({id:'study',title:'日语日记',description:'',posts:[],defaults:{categories:['学习'],tags:['日语']},rule:{categories:[],tags:['日语'],match:'any',order:'newest'},excluded:[]});
test('taxonomy editing preserves existing category hierarchy and unrelated front matter',()=>{
 const root=temporary();try{write(root,'source/_posts/one.md',sample);let doc=details(root,'source/_posts/one.md');assert.deepEqual(doc.categories,['学习 / 日语']);
 const before=matter.parse(sample),saved=matter.parse(serialize(sample,{...doc,body:'只改正文。'}));assert.deepEqual(saved.categories,before.categories);assert.deepEqual(saved.tags,before.tags);assert.equal(saved.permalink,'stable/');
 const changed=matter.parse(updateTaxonomy(sample,{categories:['学习 / 日语','生活'],tags:['日语','语法']}));assert.deepEqual(changed.categories,[['学习','日语'],['生活']]);assert.equal(changed._content,before._content);assert.equal(changed.permalink,before.permalink);
 const weird=sample.replace('tags: [听力]','tags: ["  带空格,标签  "]');write(root,'source/_posts/one.md',weird);doc=details(root,'source/_posts/one.md');assert.deepEqual(matter.parse(serialize(weird,{...doc,title:'仅改标题'})).tags,['  带空格,标签  ']);
 assert.throws(()=>updateTaxonomy(sample,{tags:['bad\nname']}));assert.throws(()=>updateTaxonomy(sample,{categories:'学习'}));
 const windows='\uFEFF'+sample.replace(/\n/g,'\r\n');write(root,'source/_posts/windows.md',windows);const win=details(root,'source/_posts/windows.md');assert.equal(win.title,'学习记录');assert.deepEqual(win.categories,['学习 / 日语']);assert(!win.body.includes('categories:'));
 assert.deepEqual(matter.parse(updateTaxonomy(windows,{tags:['日语']})).categories,['学习','日语']);
 }finally{clean(root);}
});
test('series defaults apply only to new drafts and automatic rules respect manual exclusions',async()=>{
 const root=temporary();write(root,'source/_drafts/old.md',sample);const server=createStudio({root});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try{const c=library(root);c.series.push(study());saveLibrary(root,c);
 const {token}=await(await fetch(base+'/api/session')).json(),headers={Origin:base,'Content-Type':'application/json','X-Studio-Token':token};
 const api=async(route,data)=>{const response=await fetch(base+'/api/'+route,{method:'POST',headers,body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
 const draft=await api('new',{series:'study'});assert.deepEqual(draft.categories,['学习']);assert.deepEqual(draft.tags,['日语']);assert.equal((await api('new',{series:'study'})).id,draft.id);assert.equal(fs.readFileSync(path.join(root,'source/_drafts/old.md'),'utf8'),sample);
 const config=library(root);config.series[0].defaults.tags=['新默认'];saveLibrary(root,config);assert.deepEqual(details(root,draft.id).tags,['日语']);
 const docs=[{id:'source/_posts/a.md',date:'2026-09-11',categories:['学习 / 日语'],tags:['日语']},{id:'source/_drafts/b.md',date:'2026-09-12',categories:[],tags:['日语']},{id:'source/_drafts/c.md',date:'2026-09-13',categories:[],tags:[]}];
 assert(taxonomy.matches({categories:['学习'],tags:['日语'],match:'all'},docs[0]));assert(!taxonomy.matches({categories:['学习'],tags:['日语'],match:'all'},docs[1]));
 const s=study();assert.deepEqual(taxonomy.members(s,docs).map(p=>path.basename(p.id)),['b.md','a.md']);s.posts=['c.md'];s.excluded=['b.md'];assert.deepEqual(taxonomy.members(s,docs).map(p=>path.basename(p.id)),['c.md','a.md']);
 const next=library(root);next.series[0].excluded=[path.basename(draft.id)];saveLibrary(root,next);const entry=trash(root,[details(root,draft.id)])[0];assert(!library(root).series[0].excluded.includes(path.basename(draft.id)));restore(root,entry.key);assert(library(root).series[0].excluded.includes(path.basename(draft.id)));
 }finally{await new Promise(r=>server.close(r));clean(root);}
});
test('batch taxonomy is atomic on stale input, supports append/remove/replace, and undo protects later writing',()=>{
 const root=temporary();try{for(const n of ['one','two'])write(root,'source/_drafts/'+n+'.md',sample);
 const docs=['one','two'].map(n=>details(root,'source/_drafts/'+n+'.md'));
 assert.throws(()=>applyBatch(root,{items:[docs[0],{...docs[1],revision:'stale'}],tags:{mode:'add',values:['日语']}}));assert.equal(fs.readFileSync(path.join(root,docs[0].id),'utf8'),sample);
 let result=applyBatch(root,{items:docs,tags:{mode:'add',values:['日语','听力']}});assert.equal(result.changed.length,2);assert.deepEqual(result.changed[0].tags,['听力','日语']);assert.equal(matter.parse(fs.readFileSync(path.join(root,docs[0].id),'utf8'))._content,matter.parse(sample)._content);
 undoBatch(root,result.undo);assert.equal(fs.readFileSync(path.join(root,docs[0].id),'utf8'),sample);
 result=applyBatch(root,{items:docs,categories:{mode:'replace',values:['生活']},tags:{mode:'remove',values:['听力']}});assert.deepEqual(result.changed[0].categories,['生活']);assert.deepEqual(result.changed[0].tags,[]);
 write(root,docs[1].id,fs.readFileSync(path.join(root,docs[1].id),'utf8')+'后续写作');assert.throws(()=>undoBatch(root,result.undo));assert.deepEqual(details(root,docs[0].id).categories,['生活']);assert.match(fs.readFileSync(path.join(root,docs[1].id),'utf8'),/后续写作/);
 }finally{clean(root);}
});
test('automatic online series use committed taxonomy and only the selected publication snapshot',async()=>{
 const dir=temporary(),root=path.join(dir,'project'),remote=path.join(dir,'remote.git');fs.mkdirSync(root);
 try{await run('git',['init','--bare',remote],dir);await run('git',['init','-b','main'],root);await run('git',['config','user.name','Studio QA'],root);await run('git',['config','user.email','qa@example.invalid'],root);
 write(root,'.gitignore','.studio/\nnode_modules\nsource/_drafts/\n');write(root,'source/_posts/old.md',sample);write(root,'source/_data/notebook.yml','series: []\n');write(root,'tools/build.cjs',"const fs=require('fs'),yaml=require('js-yaml'),c=yaml.load(fs.readFileSync('source/_data/notebook.yml','utf8'));if(JSON.stringify(c.series[0].posts)!==JSON.stringify(['chosen.md']))throw Error('Unpublished taxonomy leaked');const doc=require('hexo-front-matter').parse(fs.readFileSync('source/_posts/chosen.md','utf8'));if(!doc.tags.includes('日语'))throw Error('Missing selected tags');");
 fs.symlinkSync(path.resolve('node_modules'),path.join(root,'node_modules'),process.platform==='win32'?'junction':'dir');await run('git',['add','.'],root);await run('git',['commit','-m','Initial'],root);await run('git',['remote','add','origin',remote],root);await run('git',['push','-u','origin','main'],root);
 const selected=updateTaxonomy(sample,{tags:['日语']});write(root,'source/_posts/old.md',selected);write(root,'source/_drafts/chosen.md',selected);write(root,'source/_drafts/other.md',selected);write(root,'source/_posts/untracked.md',selected);
 const collection={series:[study()],templates:[]};const pre=await publishedCollection(root,'HEAD',collection);assert.deepEqual(pre.collection.series[0].posts,[]);
 await publish(root,[{id:'source/_drafts/chosen.md',revision:revision(selected)}],state=>{if(state.state==='building')write(root,'source/_drafts/chosen.md',updateTaxonomy(selected,{tags:['稍后修改']}));},collection);
 const publicData=yaml.load(await run('git',['--git-dir='+remote,'show','main:source/_data/notebook.yml'],root));assert.deepEqual(publicData.series[0].posts,['chosen.md']);assert(!publicData.series[0].rule);assert(!publicData.series[0].defaults);
 assert.deepEqual(details(root,'source/_posts/chosen.md').tags,['稍后修改']);assert.deepEqual(details(root,'source/_posts/old.md').tags,['日语']);
 }finally{const link=path.join(root,'node_modules');if(fs.existsSync(link)&&fs.lstatSync(link).isSymbolicLink())fs.unlinkSync(link);clean(dir);}
});
