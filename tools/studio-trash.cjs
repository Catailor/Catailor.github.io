'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {safePath, details, revision} = require('./studio-content.cjs');
const {posts, library, saveLibrary, basename, resolveId} = require('./studio-library.cjs');
function folder(root, key) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new Error('回收站记录不正确');
  return path.join(root,'.studio/trash',key);
}
function listTrash(root) {
  const dir=path.join(root,'.studio/trash');
  if(!fs.existsSync(dir))return [];
  return fs.readdirSync(dir).flatMap(key=>{try{return [{...JSON.parse(fs.readFileSync(path.join(folder(root,key),'entry.json'),'utf8')),key}];}catch(_){return [];}}).sort((a,b)=>b.deleted.localeCompare(a.deleted));
}
function trash(root, items) {
  if(!Array.isArray(items)||!items.length||items.length>200)throw new Error('请选择要删除的草稿');
  const all=posts(root), collection=library(root), seen=new Set();
  const entries=items.map(item=>{
    const id=resolveId(root,item.id), post=all.find(p=>p.id===id);
    if(!post||seen.has(id))throw new Error('文章不存在或重复，请刷新列表');seen.add(id);
    if(post.isPublished)throw new Error('已发布文章请先撤回为草稿，确认下线后再移入回收站');
    if(post.revision!==item.revision)throw new Error('文章已改变，请刷新后重试');
    const bytes=fs.readFileSync(safePath(root,id));
    return {key:crypto.randomUUID(),id,title:post.title,date:post.date,deleted:new Date().toISOString(),members:collection.series.filter(s=>s.posts.includes(basename(id))).map(s=>({id:s.id,index:s.posts.indexOf(basename(id))})),excludedBy:collection.series.filter(s=>(s.excluded||[]).includes(basename(id))).map(s=>s.id),bytes};
  });
  // Persist recovery copies before removing any active file.
  for(const {key,bytes,...entry} of entries){const dir=folder(root,key);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'body.md'),bytes);fs.writeFileSync(path.join(dir,'entry.json'),JSON.stringify(entry));}
  try {
    const next=structuredClone(collection), names=new Set(entries.map(e=>basename(e.id)));
    next.series.forEach(s=>{s.posts=s.posts.filter(n=>!names.has(n));s.excluded=(s.excluded||[]).filter(n=>!names.has(n));});
    saveLibrary(root,next);
    for(const e of entries)fs.unlinkSync(safePath(root,e.id));
  } catch(error) {
    for(const e of entries)if(!fs.existsSync(safePath(root,e.id)))fs.writeFileSync(safePath(root,e.id),e.bytes);
    try{saveLibrary(root,{...collection,revision:library(root).revision});}catch(_){}
    for(const e of entries)fs.rmSync(folder(root,e.key),{recursive:true,force:true});
    throw error;
  }
  return entries.map(({bytes,...entry})=>entry);
}
function restore(root,key) {
  const dir=folder(root,key), entry=JSON.parse(fs.readFileSync(path.join(dir,'entry.json'),'utf8'));
  const file=safePath(root,entry.id), other=safePath(root,entry.id.startsWith('source/_drafts/')?entry.id.replace('source/_drafts/','source/_posts/'):entry.id.replace('source/_posts/','source/_drafts/'));
  if(fs.existsSync(file)||fs.existsSync(other))throw new Error('已有同名文章，恢复不会覆盖现有内容');
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,fs.readFileSync(path.join(dir,'body.md')),{flag:'wx'});
  try {const next=library(root);for(const member of entry.members){const s=next.series.find(s=>s.id===member.id);if(s&&!s.posts.includes(basename(entry.id)))s.posts.splice(member.index,0,basename(entry.id));}for(const id of entry.excludedBy||[]){const s=next.series.find(s=>s.id===id);if(s)s.excluded=[...new Set([...(s.excluded||[]),basename(entry.id)])];}saveLibrary(root,next);}catch(e){fs.unlinkSync(file);throw e;}
  fs.rmSync(dir,{recursive:true});return details(root,entry.id);
}
function discardEmpty(root,input) {
  const id=resolveId(root,input.id), doc=details(root,id), raw=fs.readFileSync(safePath(root,id),'utf8'), data=require('./studio-content.cjs').parseDocument(raw);
  if(!id.startsWith('source/_drafts/')||!data.studio_empty||doc.title.trim()||doc.body.trim()||doc.summary.trim()||revision(raw)!==input.revision)return {discarded:false};
  const next=library(root);next.series.forEach(s=>{s.posts=s.posts.filter(n=>n!==basename(id));s.excluded=(s.excluded||[]).filter(n=>n!==basename(id));});saveLibrary(root,next);fs.unlinkSync(safePath(root,id));return {discarded:true};
}
module.exports={listTrash,trash,restore,discardEmpty};
