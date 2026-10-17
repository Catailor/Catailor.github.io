'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const matter = require('hexo-front-matter');
const {md} = require('../lib/article-renderer.cjs');
const { plainText, summaryText } = require('../lib/notebook');
const taxonomy = require('../lib/studio-taxonomy');
const revision = text => crypto.createHash('sha256').update(text).digest('hex');
// Front matter parses a zone-less timestamp in the local timezone. Display it in
// that same timezone; converting to UTC can show the preceding calendar day.
const noteDay = value => value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` : String(value || '').slice(0, 10);
function safePath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.split('/').some(p => p === '..' || p === '.') || !/^(source\/(?:_drafts|_posts)\/[\p{L}\p{N}_. -]+\.md|source\/img\/uploads\/[a-zA-Z0-9_.-]+|source\/private\/vault\.json)$/u.test(relative)) throw new Error('文件路径不合法');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('文件不在项目中');
  let cursor = absolute;
  while (cursor !== path.resolve(root)) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('不支持链接文件');
    cursor = path.dirname(cursor);
  }
  return absolute;
}
function parse(text) {
  const data = matter.parse(String(text).replace(/^\uFEFF/,'').replace(/\r\n/g,'\n'));
  if (data.private || data.password) throw new Error('私人内容请使用加密手记入口');
  return data;
}
function details(root, id) {
  const raw = fs.readFileSync(safePath(root, id), 'utf8'), data = parse(raw);
  let display = {};
  if (!data.studio_edited) { const file = path.join(root, 'source/_data/moonlit.yml'); if (fs.existsSync(file)) display = require('js-yaml').load(fs.readFileSync(file, 'utf8'))?.posts?.[path.basename(id)] || {}; }
  return { id, revision: revision(raw), title: display.title || data.title || '', date: noteDay(data.date), summary: display.summary || data.description || '', body: data._content || '', ...taxonomyDetails(data), japanese: [].concat(data.categories || []).includes('日语学习'), draft: id.startsWith('source/_drafts/'), ...noteDetails(data) };
}
// Readable link names live in the permalink: YYYY/MM/DD/<link>/.
const LINK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/, KINDS = ['study', 'life', 'moment'];
const STUDIO_PERMALINK = /^\/?\d{4}\/\d{2}\/\d{2}\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;
function noteDetails(data) {
  const match = String(data.permalink || '').match(STUDIO_PERMALINK);
  return { link: match ? match[1] : '', customPermalink: Boolean(data.permalink && !match), kind: KINDS.includes(data.kind) ? data.kind : '', topic: typeof data.topic === 'string' ? data.topic : '' };
}
function routeOf(data, id, config = {}) {
  if (data.permalink) return String(data.permalink).replace(/^\/+/, '').replace(/index\.html$/, '').replace(/\/?$/, '/');
  const day = noteDay(data.date).split('-'), slug = data.slug || path.posix.basename(id, '.md');
  return String(config.permalink || ':year/:month/:day/:title/').replace(':year', day[0]).replace(':month', day[1]).replace(':day', day[2]).replace(':title', slug).replace(/^\/+/, '');
}
function assignNote(data, input) {
  if (input.kind !== undefined) {
    if (input.kind && !KINDS.includes(input.kind)) throw new Error('文章类型不正确');
    if (input.kind) data.kind = input.kind; else delete data.kind;
  }
  if (input.topic !== undefined) {
    const topic = String(input.topic).trim();
    if (topic.length > 40) throw new Error('主题请控制在 40 个字以内');
    if (topic) data.topic = topic; else delete data.topic;
  }
  if (input.link !== undefined) {
    const link = String(input.link).trim().toLowerCase();
    if (link && (link.length > 80 || !LINK.test(link))) throw new Error('链接名只用小写英文、数字和短横线，例如 japanese-day-1');
    if (link) data.permalink = input.date.replace(/-/g, '/') + '/' + link + '/';
    else if (STUDIO_PERMALINK.test(String(data.permalink || ''))) delete data.permalink;
  }
}
// When a published post's address changes (new link name or date), keep the old address as a redirect.
function assignRedirects(data, id, published, config) {
  if (!published) return;
  const before = parse(published), from = routeOf(before, id, config), to = routeOf(data, id, config);
  const normalize = r => String(r).replace(/^\/+/, '').replace(/index\.html$/, '').replace(/\/?$/, '/');
  const list = [...new Set([...[].concat(before.redirect_from || []).map(normalize), ...(from !== to ? [from] : [])])].filter(r => r !== to);
  if (list.length) data.redirect_from = list.map(r => '/' + r); else delete data.redirect_from;
}
function taxonomyDetails(data){return {categories:taxonomy.categories(data.categories),tags:taxonomy.tags(data.tags)};}
function assignTaxonomy(data,input){
  for(const kind of ['categories','tags'])if(input[kind]!==undefined){
    if(JSON.stringify(input[kind])===JSON.stringify(taxonomyDetails(data)[kind]))continue;
    const next=taxonomy.validate(input[kind]);
    if(JSON.stringify(next)!==JSON.stringify(taxonomyDetails(data)[kind]))data[kind]=kind==='categories'?taxonomy.categoryData(next):next;
  }
}
function updateTaxonomy(previous,input){const data=parse(previous);assignTaxonomy(data,input);return '---\n'+matter.stringify(data);}
function serialize(previous, input, published = null, config = {}) {
  const data = parse(previous);
  if (typeof input.title !== 'string' || input.title.length > 200 || typeof input.body !== 'string' || input.body.length > 200000 || typeof input.summary !== 'string' || input.summary.length > 500) throw new Error('文章内容过长或格式不正确');
  const date = new Date(input.date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(+date) || date.toISOString().slice(0, 10) !== input.date) throw new Error('请填写正确日期');
  const oldDay = noteDay(data.date);
  delete data.studio_empty;
  assignTaxonomy(data,input);
  assignNote(data, input);
  if (input.id) assignRedirects(data, input.id, published, config);
  // Preserve the original time and all unrelated front matter, including stable permalinks.
  return '---\n' + matter.stringify({ ...data, studio_edited: true, title: input.title, date: oldDay === input.date ? data.date : `${input.date} 12:00:00`, description: input.summary, _content: input.body });
}
function validatePublication(text, id = '') {
  const data = parse(text), body = data._content || '';
  if (!String(data.title || '').trim() || /{{|}}/.test(data.title)) throw new Error('请先填写文章标题');
  const meaningful = body.split('\n').filter(line => !/^\s*(#|\||<!--|$)/.test(line) && !/^\s*-\s+[^：:]+[：:]\s*$/.test(line)).join('\n');
  const rendered = require('cheerio').load(md.render(body));
  const tableContent = rendered('table td').toArray().some(cell => rendered(cell).text().trim());
  if (!plainText(md.render(meaningful)).trim() && !tableContent && !rendered('img[src]').length) throw new Error('草稿还没有正文，请写完后再发布');
  if (/{{[^}]+}}/.test(body)) throw new Error('还有模板占位文字，请填写或删除后再发布');
  const tips = [];
  if (!String(data.description || '').trim()) tips.push('还没有写摘要：首页和分享卡片会自动截取正文开头。');
  if (!taxonomy.categories(data.categories).length) tips.push('还没有分类：选一个分类，读者更容易找到它。');
  if (!data.permalink && !data.slug && /\/note-[0-9a-f-]{20,}\.md$/.test(id)) tips.push('链接还是随机编号：可以在文章设置里起一个好记的链接名。');
  return { title: data.title, summary: data.description || summaryText(md.render(body)), category: taxonomy.categories(data.categories).join('、') || '未分类', tags:taxonomy.tags(data.tags), tips };
}
function selectedAssets(root, text) {
  const assets = new Set();
  for (const match of text.matchAll(/(?:\/img\/uploads\/)([a-zA-Z0-9_.-]+)/g)) {
    const id = 'source/img/uploads/' + match[1];
    if (!fs.existsSync(safePath(root, id))) throw new Error('配图不存在：' + match[1]);
    assets.add(id);
  }
  return [...assets];
}
function imageWarnings(root, body){
  const $=require('cheerio').load(md.render(body)),warnings=[];
  $('img[src]').each((_,image)=>{
    const src=$(image).attr('src');if(!src.startsWith('/'))return;
    let rel;try{rel=decodeURIComponent(src.split(/[?#]/)[0]);}catch(_){warnings.push('图片地址无法识别：'+src);return;}
    const base=path.resolve(root,'source'),file=path.resolve(base,'.'+rel);
    if(!file.startsWith(base+path.sep)||!fs.existsSync(file))warnings.push('找不到本机图片：'+src);
  });return [...new Set(warnings)];
}
function publishedUrl(root,id){
  if(id==='source/private/vault.json')return 'https://catailor.github.io/private/';
  try{
    const raw=fs.readFileSync(safePath(root,require('./studio-library.cjs').resolveId(root,id)),'utf8'),data=parse(raw);
    const configFile=path.join(root,'_config.yml'),config=fs.existsSync(configFile)?require('js-yaml').load(fs.readFileSync(configFile,'utf8')):{};
    const day=noteDay(data.date).split('-'),slug=data.slug||path.posix.basename(id,'.md');
    const route=data.permalink||String(config.permalink||':year/:month/:day/:title/').replace(':year',day[0]).replace(':month',day[1]).replace(':day',day[2]).replace(':title',encodeURIComponent(slug));
    const url=new URL(route,config.url||'https://catailor.github.io/');return /^https?:$/.test(url.protocol)?url.href:null;
  }catch(_){return null;}
}
module.exports = { routeOf, noteDetails, safePath, revision, details, serialize, validatePublication, selectedAssets, md, taxonomyDetails, updateTaxonomy, noteDay, imageWarnings, publishedUrl, parseDocument:parse };
