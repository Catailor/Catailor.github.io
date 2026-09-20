'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { safePath, validatePublication, selectedAssets, revision, taxonomyDetails, noteDay } = require('./studio-content.cjs');
const taxonomy=require('../lib/studio-taxonomy');
const { validateEnvelope } = require('../source/js/vault-crypto');
const { publicConfig } = require('./studio-library.cjs');
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false }); let output = '';
    const timer = setTimeout(() => child.kill(), 240000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-40000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-40000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(output || '操作失败或超时')); });
  });
}
async function publish(root, selection, report, collection = null) {
  if ((!selection.length && !collection) || selection.length > 20) throw new Error('请选择发布内容');
  collection = collection ? structuredClone(collection) : null;
  const selected = selection.map(item => {
    const file = safePath(root, item.id), bytes = fs.readFileSync(file);
    if (revision(bytes) !== item.revision) throw new Error('内容已改变，请刷新发布预览');
    if(item.action==='withdraw') {
      if(!item.id.startsWith('source/_posts/'))throw new Error('只能撤回已发布文章');
      if(fs.existsSync(safePath(root,item.id.replace('source/_posts/','source/_drafts/'))))throw new Error('已有同名草稿，请先整理后撤回');
    } else if (item.id === 'source/private/vault.json') validateEnvelope(JSON.parse(bytes)); else validatePublication(bytes.toString('utf8'));
    return { id: item.id, dest: item.id.replace('source/_drafts/', 'source/_posts/'), bytes, withdraw:item.action==='withdraw' };
  });
  for (const item of selected) if (item.id !== item.dest && fs.existsSync(safePath(root, item.dest))) throw new Error('已有同名文章，请在文章列表编辑它');
  const payload = new Map(selected.map(item => [item.dest, item.withdraw?null:item.bytes]));
  for (const item of selected) if (!item.withdraw && item.id !== 'source/private/vault.json') for (const asset of selectedAssets(root, item.bytes.toString('utf8'))) payload.set(asset, fs.readFileSync(safePath(root, asset)));
  const originals = new Map([...payload.keys(), 'source/studio-release.json'].map(id => {
    const file = path.join(root, id); return [id, fs.existsSync(file) ? fs.readFileSync(file) : null];
  }));
  if (await run('git', ['branch', '--show-current'], root) !== 'main') throw new Error('请在 main 分支使用发布入口');
  if (await run('git', ['diff', '--cached', '--name-only'], root)) throw new Error('项目还有暂存的其他改动，请先完成该次操作再发布');
  const base = await run('git', ['rev-parse', 'HEAD'], root);
  for(const item of selected)if(item.withdraw)await run('git',['cat-file','-e',base+':'+item.id],root);
  const remote = (await run('git', ['ls-remote', 'origin', 'refs/heads/main'], root)).split(/\s/)[0];
  if (base !== remote) throw new Error('本机和线上版本不同，请先同步项目，再发布所选文章');
  if (collection) {
    const {eligible,collection:publicCollection}=await publishedCollection(root,base,collection,selected);
    let config = '';
    try { config = await run('git',['show',base+':source/_data/notebook.yml'],root); } catch (_) {}
    const id = 'source/_data/notebook.yml', file = path.join(root,id);
    originals.set(id,fs.existsSync(file) ? fs.readFileSync(file) : null);
    const yaml=require('js-yaml'), nextConfig=yaml.load(publicConfig(config,publicCollection,eligible));
    const withdrawn=new Set(selected.filter(i=>i.withdraw).map(i=>path.posix.basename(i.id)));
    if(withdrawn.size&&nextConfig.related){for(const name of Object.keys(nextConfig.related)){if(withdrawn.has(name))delete nextConfig.related[name];else nextConfig.related[name]=nextConfig.related[name].filter(target=>!withdrawn.has(target));}}
    payload.set(id,Buffer.from(yaml.dump(nextConfig,{lineWidth:120,noRefs:true})));
  }
  const work = path.join(root, '.studio', 'work-' + crypto.randomUUID()), release = crypto.randomUUID();
  let created = false, pushed = false;
  try {
    report({ state: 'building', message: '正在检查所选内容并生成网站…' });
    fs.mkdirSync(path.dirname(work), { recursive: true });
    await run('git', ['worktree', 'add', '--detach', work, base], root); created = true;
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const files = new Set();
    for (const [id, bytes] of payload) {
      const destination = id === 'source/_data/notebook.yml' ? path.join(work,id) : safePath(work, id); fs.mkdirSync(path.dirname(destination), { recursive: true }); if(bytes===null)fs.unlinkSync(destination);else fs.writeFileSync(destination, bytes); files.add(id);
    }
    fs.writeFileSync(path.join(work, 'source/studio-release.json'), JSON.stringify({ release })); files.add('source/studio-release.json');
    await run(process.execPath, [path.join(work, 'tools/build.cjs')], work);
    await run('git', ['add', '--', ...files], work);
    await run('git', ['commit', '-m', 'Publish selected notebook entries'], work);
    const commit = await run('git', ['rev-parse', 'HEAD'], work);
    // Recheck before the irreversible push; never force push or sweep unrelated files.
    if (await run('git', ['rev-parse', 'HEAD'], root) !== base || await run('git', ['diff', '--cached', '--name-only'], root)) throw new Error('项目在发布期间发生变化，请重新预览后发布');
    report({ state: 'uploading', message: '检查通过，正在上传所选内容…' });
    await run('git', ['push', 'origin', 'HEAD:main'], work); pushed = true;
    // Keep all unrelated working files intact while advancing the local branch/index.
    await run('git', ['update-ref', 'HEAD', commit, base], root);
    for (const file of files) {
      const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), { recursive: true });
      if(payload.has(file)&&payload.get(file)===null) {
        const draft=safePath(root,file.replace('source/_posts/','source/_drafts/'));
        fs.mkdirSync(path.dirname(draft),{recursive:true});
        if(fs.existsSync(draft))throw new Error('撤回已上传，但本机出现同名草稿，原文章已保留，请整理后同步');
        const latest=fs.existsSync(destination)?fs.readFileSync(destination):selected.find(i=>i.id===file).bytes;
        fs.writeFileSync(draft,latest,{flag:'wx'});if(fs.existsSync(destination))fs.unlinkSync(destination);
        continue;
      }
      const original = originals.get(file), current = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
      if (original ? current?.equals(original) : current === null) {
        if (file === 'source/_data/notebook.yml' && current) {
          const yaml = require('js-yaml'), local = yaml.load(current.toString('utf8')) || {};
          local.series = yaml.load(payload.get(file).toString('utf8')).series;
          fs.writeFileSync(destination,yaml.dump(local,{lineWidth:120,noRefs:true}));
        } else fs.copyFileSync(path.join(work, file), destination);
      }
    }
    for (const item of selected) if (item.id !== item.dest) {
      const draft = safePath(root, item.id);
      // Move the latest local draft, not the captured publication bytes. A save
      // arriving on the old id is resolved to this destination by the server.
      if (fs.existsSync(draft)) {
        const destination = safePath(root,item.dest), now = fs.readFileSync(destination);
        if (now.equals(item.bytes)) { fs.writeFileSync(destination,fs.readFileSync(draft)); fs.unlinkSync(draft); }
      }
    }
    await run('git', ['reset', 'HEAD', '--', ...files], root);
    report({ state: 'deploying', message: selected.some(i=>i.withdraw)?'撤回已上传，等待网站下线文章；正文已保留为本机草稿。':'已上传，等待网站更新…', commit, release });
  } catch (error) {
    if (pushed) throw new Error('内容已上传，但本机同步未完成。请先同步项目，避免重复发布。' + error.message);
    throw error;
  } finally {
    if (created) {
      const absolute = path.resolve(work);
      if (path.dirname(absolute) !== path.resolve(root, '.studio') || !path.basename(absolute).startsWith('work-')) throw new Error('临时工作区路径不正确');
      const modules = path.join(absolute, 'node_modules');
      if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) fs.unlinkSync(modules);
      await run('git', ['worktree', 'remove', '--force', absolute], root).catch(() => {});
    }
  }
}
async function seriesChanges(root,collection,selection=[]) {
  let base='',head='HEAD';
  try {head=await run('git',['rev-parse','HEAD'],root);base=await run('git',['show',head+':source/_data/notebook.yml'],root);}catch(_){}
  const {eligible,collection:publicCollection}=await publishedCollection(root,head,collection,selection);
  const yaml=require('js-yaml'), before=(yaml.load(base)||{}).series||[], after=(yaml.load(publicConfig(base,publicCollection,eligible))||{}).series||[];
  const changes=[];
  for(const old of before)if(!after.some(s=>s.id===old.id))changes.push(`解散系列「${old.title}」（文章保留）`);
  for(const next of after){const old=before.find(s=>s.id===next.id);if(!old){changes.push(`新增系列「${next.title}」：${next.posts.length} 篇已发布文章`);continue;}
    const edits=[];if((old.homepage??old.id==='japanese')!==next.homepage||Number(old.homeOrder||0)!==Number(next.homeOrder||0))edits.push('更新首页展示');if(old.title!==next.title)edits.push(`由「${old.title}」改名`);if((old.description||'')!==next.description)edits.push('修改简介');
    if(JSON.stringify(old.posts||[])!==JSON.stringify(next.posts)||old.category)edits.push(`更新成员或顺序（${next.posts.length} 篇）`);
    if(edits.length)changes.push(`「${next.title}」：${edits.join('、')}`);
  }
  if(JSON.stringify(before.map(s=>s.id))!==JSON.stringify(after.map(s=>s.id))&&before.length===after.length&&before.every(s=>after.some(n=>n.id===s.id)))changes.push('调整系列之间的显示顺序');
  return changes;
}
async function publishedCollection(root,head,collection,selection=[]){
  let names='';try{names=await run('git',['-c','core.quotepath=false','ls-tree','-r','--name-only',head,'--','source/_posts'],root);}catch(_){}
  const docs=new Map(),parse=require('./studio-content.cjs').parseDocument;
  const add=(id,bytes)=>{const data=parse(bytes.toString('utf8'));docs.set(path.posix.basename(id),{id,date:noteDay(data.date),...taxonomyDetails(data)});};
  // Only read committed metadata here. An unrelated post's local tag edit must
  // not enter the online series merely because another article is published.
  for(const id of names.split('\n').filter(n=>n.endsWith('.md'))){
    const bytes=require('node:child_process').execFileSync('git',['show',head+':'+id],{cwd:root,windowsHide:true,maxBuffer:20000000,stdio:['ignore','pipe','pipe']});add(id,bytes);
  }
  for(const item of selection){if(item.id==='source/private/vault.json')continue;
    if(item.withdraw||item.action==='withdraw')docs.delete(path.posix.basename(item.id));
    else add(item.id,item.bytes||fs.readFileSync(safePath(root,item.id)));
  }
  const next=structuredClone(collection),available=[...docs.values()];
  next.series.forEach(s=>s.posts=taxonomy.members(s,available).map(p=>path.posix.basename(p.id)));
  return {eligible:new Set(docs.keys()),collection:next};
}
module.exports = { publish, run, seriesChanges, publishedCollection };
