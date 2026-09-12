'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const matter = require('hexo-front-matter');
const Markdown = require('markdown-it');
const md = new Markdown({ html: false, breaks: true }).use(require('@renbaoshuo/markdown-it-katex'));
const { plainText, summaryText } = require('../lib/notebook');
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
  const data = matter.parse(text);
  if (data.private || data.password) throw new Error('私人内容请使用加密手记入口');
  return data;
}
function details(root, id) {
  const raw = fs.readFileSync(safePath(root, id), 'utf8'), data = parse(raw);
  let display = {};
  if (!data.studio_edited) { const file = path.join(root, 'source/_data/moonlit.yml'); if (fs.existsSync(file)) display = require('js-yaml').load(fs.readFileSync(file, 'utf8'))?.posts?.[path.basename(id)] || {}; }
  return { id, revision: revision(raw), title: display.title || data.title || '', date: noteDay(data.date), summary: display.summary || data.description || '', body: data._content || '', japanese: [].concat(data.categories || []).includes('日语学习'), draft: id.startsWith('source/_drafts/') };
}
function serialize(previous, input) {
  const data = parse(previous);
  if (typeof input.title !== 'string' || input.title.length > 200 || typeof input.body !== 'string' || input.body.length > 200000 || typeof input.summary !== 'string' || input.summary.length > 500) throw new Error('文章内容过长或格式不正确');
  const date = new Date(input.date + 'T12:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || Number.isNaN(+date) || date.toISOString().slice(0, 10) !== input.date) throw new Error('请填写正确日期');
  const oldDay = noteDay(data.date);
  // Preserve the original time and all unrelated front matter, including stable permalinks.
  return '---\n' + matter.stringify({ ...data, studio_edited: true, title: input.title, date: oldDay === input.date ? data.date : `${input.date} 12:00:00`, description: input.summary, _content: input.body });
}
function validatePublication(text) {
  const data = parse(text), body = data._content || '';
  if (!String(data.title || '').trim() || /{{|}}/.test(data.title)) throw new Error('请先填写文章标题');
  const meaningful = body.split('\n').filter(line => !/^\s*(#|\||<!--|$)/.test(line) && !/^\s*-\s+[^：:]+[：:]\s*$/.test(line)).join('\n');
  const rendered = require('cheerio').load(md.render(body));
  const tableContent = rendered('table td').toArray().some(cell => rendered(cell).text().trim());
  if (!plainText(md.render(meaningful)).trim() && !tableContent && !rendered('img[src]').length) throw new Error('草稿还没有正文，请写完后再发布');
  if (/{{[^}]+}}/.test(body)) throw new Error('还有模板占位文字，请填写或删除后再发布');
  return { title: data.title, summary: data.description || summaryText(md.render(body)), category: [].concat(data.categories || []).join('、') || '随手记录' };
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
module.exports = { safePath, revision, details, serialize, validatePublication, selectedAssets, md };
