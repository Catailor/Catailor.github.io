'use strict';
const fs = require('node:fs'), path = require('node:path');
const yaml = require('js-yaml');
const { execFileSync } = require('node:child_process');
const { details, revision, safePath } = require('./studio-content.cjs');
const taxonomy = require('../lib/studio-taxonomy');
const basename = id => path.posix.basename(id);
function resolveId(root, id) {
  const file = safePath(root, id);
  if (!fs.existsSync(file) && id.startsWith('source/_drafts/')) {
    const published = id.replace('source/_drafts/', 'source/_posts/');
    if (fs.existsSync(safePath(root, published))) return published;
  }
  if (!fs.existsSync(file) && id.startsWith('source/_posts/')) {
    const draft = id.replace('source/_posts/', 'source/_drafts/');
    if (fs.existsSync(safePath(root, draft))) return draft;
  }
  return id;
}
function posts(root) {
  const result = [];
  let tracked = new Map(), modified = new Set();
  try {
    const tree = execFileSync('git', ['-c','core.quotepath=false','ls-tree', '-r', 'HEAD', '--', 'source/_posts'], {cwd:root, windowsHide:true, encoding:'utf8', stdio:['ignore','pipe','ignore']});
    tracked = new Map(tree.trim().split('\n').map(line => { const [meta, id] = line.split('\t'); return [id, meta?.split(' ')[2]]; }));
    modified = new Set(execFileSync('git',['diff','--name-only','-z','HEAD','--','source/_posts'],{cwd:root,windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\0'));
  } catch (_) {}
  for (const directory of ['source/_drafts', 'source/_posts']) {
    if (!fs.existsSync(path.join(root, directory))) continue;
    for (const name of fs.readdirSync(path.join(root, directory))) {
      if (!name.endsWith('.md')) continue;
      try {
        const id = directory + '/' + name, item = details(root, id);
        item.status = !tracked.has(id) ? 'draft' : modified.has(id) ? 'changed' : 'published';
        item.isPublished = tracked.has(id);
        item.modified = fs.statSync(safePath(root, id)).mtimeMs;
        delete item.body; result.push(item);
      } catch (_) {}
    }
  }
  return result.sort((a,b) => b.modified - a.modified);
}
function library(root) {
  const file = path.join(root, '.studio/library.json');
  if (!fs.existsSync(file)) {
    const configFile = path.join(root, 'source/_data/notebook.yml');
    const config = fs.existsSync(configFile) ? yaml.load(fs.readFileSync(configFile,'utf8')) || {} : {};
    const all = posts(root);
    const series = (config.series || []).map(item => ({id:item.id, title:item.title, description:item.description || '', favorite:false,homepage:item.homepage??item.id==='japanese',homeOrder:item.homeOrder||0,
      posts: item.category ? all.filter(p => taxonomy.categoryNames(p.categories).includes(item.category)).sort((a,b) => item.order === 'oldest' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)).map(p => basename(p.id)) : item.posts || []}));
    const templates = [
      {id:'daily', title:'每日记录', body:'## 今天做了什么\n\n\n\n## 想法与收获\n\n', favorite:false},
      {id:'japanese-quick', title:'日语学习 · 简记', body:'## 今天的学习\n\n\n\n| 单词 | 读音（假名） | 中文意思 | 例句与用法 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n', favorite:false},
      {id:'japanese-full', title:'日语学习 · 整理', body:'## 今天的学习\n\n\n\n## 词语\n\n| 单词 | 读音（假名） | 中文意思 | 例句与用法 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## 语法与例句\n\n\n\n## 听读练习\n\n\n\n## 下次复习\n\n', favorite:false},
      {id:'reading', title:'阅读笔记', body:'## 摘录\n\n> \n\n## 我的理解\n\n', favorite:false}
    ];
    fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify({series,templates},null,2),{flag:'wx'});
  }
  const raw = fs.readFileSync(file,'utf8'); return {...JSON.parse(raw), revision:revision(raw)};
}
function validateLibrary(value, available) {
  if (!Array.isArray(value.series) || !Array.isArray(value.templates) || value.series.length > 200 || value.templates.length > 200) throw new Error('系列或模板数量过多');
  const validate = (items, template) => {
    const ids = new Set();
    return items.map(item => {
      if (!/^[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)) throw new Error('系列或模板标识不正确'); ids.add(item.id);
      if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100) throw new Error('请填写名称，最多 100 字');
      const base = {id:item.id,title:item.title.trim(),favorite:!!item.favorite};
      if (template) {
        if (typeof item.body !== 'string' || item.body.length > 200000) throw new Error('模板正文过长');
        return {...base,body:item.body};
      }
      if (typeof item.description !== 'string' || item.description.length > 500 || !Array.isArray(item.posts) || item.posts.length > 10000 || new Set(item.posts).size !== item.posts.length || item.posts.some(name => !available.has(name))) throw new Error('系列文章或简介不正确，请刷新文章列表');
      const defaults={categories:taxonomy.validate(item.defaults?.categories||[]),tags:taxonomy.validate(item.defaults?.tags||[])};
      let rule=null;
      if(item.rule){
        if(!['any','all'].includes(item.rule.match)||!['newest','oldest'].includes(item.rule.order))throw new Error('请选择自动收集条件和顺序');
        rule={categories:taxonomy.validate(item.rule.categories||[]),tags:taxonomy.validate(item.rule.tags||[]),match:item.rule.match,order:item.rule.order};
        if(!rule.categories.length&&!rule.tags.length)throw new Error('自动收集至少需要一个分类或标签条件');
      }
      const excluded=item.excluded||[];
      if(!Array.isArray(excluded)||excluded.length>10000||new Set(excluded).size!==excluded.length||excluded.some(n=>!available.has(n)))throw new Error('系列排除名单不正确，请刷新后重试');
      return {...base,description:item.description,posts:item.posts,defaults,rule,excluded,homepage:item.homepage??item.id==='japanese',homeOrder:Math.max(0,Math.min(999,Number(item.homeOrder)||0))};
    });
  };
  return {series:validate(value.series,false),templates:validate(value.templates,true)};
}
function saveLibrary(root, value) {
  const current = library(root);
  if (value.revision !== current.revision) { const e = new Error('系列或模板已在另一个窗口修改，请刷新后重试'); e.status = 409; throw e; }
  const next = validateLibrary(value,new Set(posts(root).map(p => basename(p.id))));
  const file = path.join(root,'.studio/library.json');
  fs.copyFileSync(file,file+'.backup'); fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)); fs.renameSync(file+'.tmp',file);
  return library(root);
}
// Public metadata is derived only from committed posts plus this publication's
// snapshots. Local drafts, templates and favorites never enter the site payload.
function publicConfig(baseYaml, local, eligible) {
  const config = yaml.load(baseYaml) || {};
  const existing = new Set((config.series || []).map(s => s.id));
  config.series = local.series.map(s => ({id:s.id,title:s.title,description:s.description,homepage:s.homepage??s.id==='japanese',homeOrder:s.homeOrder||0,posts:s.posts.filter(name => eligible.has(name))})).filter(s => s.posts.length || existing.has(s.id));
  return yaml.dump(config,{lineWidth:120,noRefs:true});
}
module.exports = {posts, library, saveLibrary, resolveId, publicConfig, basename};
