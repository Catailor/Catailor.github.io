'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');
const {createStudio}=require('../tools/studio.cjs');
test('history restores writing, preserves URLs and newer content, and rejects stale or foreign versions',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-history-'));
  const id='source/_drafts/article.md',other='source/_drafts/other.md';fs.mkdirSync(path.join(root,'source/_drafts'),{recursive:true});
  for(const file of [id,other])fs.writeFileSync(path.join(root,file),'---\ntitle: 初稿\ndate: 2026-09-20 12:00:00\npermalink: keep-me/\n---\n\n最初正文。');
  const server=createStudio({root});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const {token}=await(await fetch(base+'/api/session')).json();
    const get=async route=>(await fetch(base+'/api/'+route)).json();
    const post=async(route,data)=>{const r=await fetch(base+'/api/'+route,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(data)});return{status:r.status,data:await r.json()};};
    const initial=await get('post?id='+id);const saved=(await post('save',{...initial,title:'新版',body:'更新正文。'})).data;
    const history=await get('history?id='+id);assert.equal(history.length,1);
    assert.equal((await post('history-restore',{id,revision:initial.revision,key:history[0].key})).status,409);
    const foreign=await get('post?id='+other);assert.equal((await post('history-restore',{...foreign,key:history[0].key})).status,400);
    const restored=await post('history-restore',{...saved,key:history[0].key});assert.equal(restored.status,200);assert.match(restored.data.body,/最初正文/);
    assert.match(fs.readFileSync(path.join(root,id),'utf8'),/permalink: keep-me\//);
    const next=await get('history?id='+id);assert.equal(next[0].reason,'恢复前保留');assert.equal(next.length,2);
    const undo=await post('history-restore',{...restored.data,key:next[0].key});assert.match(undo.data.body,/更新正文/);
    fs.mkdirSync(path.join(root,'source/_posts'));fs.renameSync(path.join(root,id),path.join(root,id.replace('_drafts','_posts')));
    assert.equal((await get('history?id='+id)).length,3);
  }finally{await new Promise(r=>server.close(r));if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('studio-history-'))fs.rmSync(root,{recursive:true,force:true});}
});
