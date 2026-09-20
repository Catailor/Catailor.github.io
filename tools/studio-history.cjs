'use strict';
const fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {safePath,revision,parseDocument,details}=require('./studio-content.cjs');
const {resolveId}=require('./studio-library.cjs');

function indexPath(root,id){
  safePath(root,id);
  if(!/^source\/_(posts|drafts)\//.test(id))throw new Error('请选择普通文章');
  const key=crypto.createHash('sha256').update(path.posix.basename(id)).digest('hex');
  return path.join(root,'.studio','history',key+'.json');
}
function entries(root,id){
  const file=indexPath(root,id);
  return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
}
function snapshot(root,id,raw,reason='自动保存'){
  const list=entries(root,id),hash=revision(raw);
  if(list[0]?.revision===hash)return list[0];
  const directory=path.join(root,'.studio-backups');fs.mkdirSync(directory,{recursive:true});
  const key=Date.now()+'-'+crypto.randomUUID()+'.md';
  fs.writeFileSync(path.join(directory,key),raw,{flag:'wx'});
  const data=parseDocument(raw),item={key,revision:hash,time:new Date().toISOString(),title:String(data.title||'无标题'),reason};
  list.unshift(item);
  const file=indexPath(root,id);fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file+'.tmp',JSON.stringify(list));fs.renameSync(file+'.tmp',file);
  return item;
}
function read(root,id,key){
  if(typeof key!=='string'||!/^\d+-[a-f0-9-]+\.md$/.test(key))throw new Error('历史版本不存在');
  const item=entries(root,id).find(item=>item.key===key);if(!item)throw new Error('历史版本不属于这篇文章');
  const raw=fs.readFileSync(path.join(root,'.studio-backups',key),'utf8');
  if(revision(raw)!==item.revision)throw new Error('历史版本文件已改变，无法恢复');
  const data=parseDocument(raw);
  return {...item,summary:data.description||'',body:data._content||'',raw};
}
function restoreVersion(root,input){
  const id=resolveId(root,input.id),file=safePath(root,id),old=fs.readFileSync(file,'utf8');
  if(revision(old)!==input.revision){const error=new Error('文章已在其他窗口修改，请重新查看历史后再恢复');error.status=409;throw error;}
  const previous=read(root,id,input.key);
  // Restore writing fields while preserving the current URL, dates and settings.
  const data=parseDocument(old),past=parseDocument(previous.raw);
  data.title=past.title;data.description=past.description||'';data._content=past._content||'';data.studio_edited=true;delete data.studio_empty;
  const next='---\n'+require('hexo-front-matter').stringify(data);
  snapshot(root,id,old,'恢复前保留');
  fs.writeFileSync(file+'.tmp',next);fs.renameSync(file+'.tmp',file);
  return details(root,id);
}
function importLegacy(root){
  const directory=path.join(root,'.studio-backups'),marker=path.join(root,'.studio/history/legacy-imported');
  if(fs.existsSync(marker)||!fs.existsSync(directory))return;
  const articles=[];
  for(const folder of ['_drafts','_posts']){
    const base=path.join(root,'source',folder);if(!fs.existsSync(base))continue;
    for(const name of fs.readdirSync(base).filter(name=>name.endsWith('.md'))){
      const id=`source/${folder}/${name}`;try{articles.push({id,data:parseDocument(fs.readFileSync(safePath(root,id),'utf8'))});}catch(_){}
    }
  }
  const known=new Set(articles.flatMap(article=>entries(root,article.id).map(entry=>entry.key)));
  for(const key of fs.readdirSync(directory).filter(key=>/^\d+-[a-f0-9-]+\.md$/.test(key)&&!known.has(key))){
    try{
      const raw=fs.readFileSync(path.join(directory,key),'utf8'),data=parseDocument(raw);
      const matches=articles.filter(article=>data.permalink?article.data.permalink===data.permalink:String(article.data.title||'')===String(data.title||'')&&String(article.data.date)===String(data.date));
      if(matches.length!==1)continue;
      const id=matches[0].id,list=entries(root,id);list.push({key,revision:revision(raw),time:new Date(Number(key.split('-')[0])).toISOString(),title:String(data.title||'无标题'),reason:'旧备份'});list.sort((a,b)=>b.time.localeCompare(a.time));
      const file=indexPath(root,id);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(list));fs.renameSync(file+'.tmp',file);known.add(key);
    }catch(_){}
  }
  fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,'Imported only unambiguous matches. Unmatched backups remain untouched.');
}
module.exports={snapshot,entries,read,restoreVersion,importLegacy};
