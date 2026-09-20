'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const taxonomy=require('../lib/studio-taxonomy');
const {safePath,revision,details,updateTaxonomy}=require('./studio-content.cjs');
const {resolveId}=require('./studio-library.cjs');
function undoFile(root,key){if(!/^[a-f0-9-]{36}$/.test(key))throw new Error('撤销记录不正确');return path.join(root,'.studio/taxonomy-undo',key+'.json');}
function applyBatch(root,input){
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>200)throw new Error('请一次选择 1 至 200 篇文章');
  const operations={};for(const kind of ['categories','tags']){const op=input[kind]||{mode:'keep',values:[]};if(!['keep','replace','add','remove'].includes(op.mode))throw new Error('整理方式不正确');operations[kind]={mode:op.mode,values:taxonomy.validate(op.values||[])};}
  const seen=new Set();const entries=input.items.map(item=>{
    const id=resolveId(root,item.id);if(!/^source\/(?:_posts|_drafts)\//.test(id)||seen.has(id))throw new Error('文章选择不正确');seen.add(id);
    const file=safePath(root,id),before=fs.readFileSync(file,'utf8');if(revision(before)!==item.revision)throw new Error('所选文章已改变，请刷新列表后重新整理');
    const doc=details(root,id),next={};
    for(const kind of ['categories','tags']){const op=operations[kind],old=doc[kind];next[kind]=op.mode==='replace'?op.values:op.mode==='add'?[...new Set([...old,...op.values])]:op.mode==='remove'?old.filter(v=>!op.values.includes(v)):old;}
    const after=JSON.stringify(next.categories)===JSON.stringify(doc.categories)&&JSON.stringify(next.tags)===JSON.stringify(doc.tags)?before:updateTaxonomy(before,next);
    return {id,before,after,revision:revision(after)};
  }).filter(e=>e.before!==e.after);
  if(!entries.length)return {changed:[],undo:null};
  const key=crypto.randomUUID(),record=undoFile(root,key);fs.mkdirSync(path.dirname(record),{recursive:true});fs.writeFileSync(record,JSON.stringify(entries));
  try {for(const entry of entries){const file=safePath(root,entry.id);fs.writeFileSync(file+'.tmp',entry.after);fs.renameSync(file+'.tmp',file);}}
  catch(error){for(const entry of entries)fs.writeFileSync(safePath(root,entry.id),entry.before);throw error;}
  return {changed:entries.map(e=>details(root,e.id)),undo:key};
}
function undoBatch(root,key){
  const file=undoFile(root,key),entries=JSON.parse(fs.readFileSync(file,'utf8'));
  const next=entries.map(e=>({...e,id:resolveId(root,e.id)}));
  for(const e of next)if(revision(fs.readFileSync(safePath(root,e.id)))!==e.revision)throw new Error('文章后来又有修改，不能直接撤销；请手动调整分类或标签');
  for(const e of next)fs.writeFileSync(safePath(root,e.id),e.before);
  fs.unlinkSync(file);return {changed:next.map(e=>details(root,e.id))};
}
module.exports={applyBatch,undoBatch};
