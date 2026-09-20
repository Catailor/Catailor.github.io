'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events'),{createStudio}=require('../tools/studio.cjs'),{details}=require('../tools/studio-content.cjs');
test('failed publication remains in the log after a service restart and can be reviewed again',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-publications-')),id='source/_drafts/one.md';fs.mkdirSync(path.dirname(path.join(root,id)),{recursive:true});fs.writeFileSync(path.join(root,id),'---\ntitle: 测试发布\ndate: 2026-09-20 12:00:00\npermalink: stable/\n---\n真实正文。');
  let server;
  async function start(){server=createStudio({root,publisher:async()=>{throw new Error('测试网络中断');}});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
  try{
    let base=await start();const {token}=await(await fetch(base+'/api/session')).json();
    const response=await fetch(base+'/api/publish',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify({items:[{id,revision:details(root,id).revision}]})});assert.equal(response.status,202);
    let records=await(await fetch(base+'/api/publications')).json();assert.equal(records[0].state,'error');assert.match(records[0].message,/网络中断/);assert.equal(records[0].items[0].url,'https://catailor.github.io/stable/');
    await new Promise(r=>server.close(r));base=await start();records=await(await fetch(base+'/api/publications')).json();assert.equal(records.length,1);assert.equal(records[0].items[0].id,id);
  }finally{if(server?.listening)await new Promise(r=>server.close(r));if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('studio-publications-'))fs.rmSync(root,{recursive:true,force:true});}
});
