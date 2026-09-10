'use strict';
const { load } = require('cheerio');
const path = require('node:path');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function plainText(html) {
  const $ = load(String(html || ''));
  $('script,style,.katex-mathml,.notebook-reading,.notebook-connections').remove();
  $('br').replaceWith(' ');
  $('p,h1,h2,h3,h4,li,pre,td,blockquote').append(' ');
  return $.root().text().replace(/\s+/g, ' ').trim();
}
function readingStats(text) {
  const chinese = (text.match(/\p{Script=Han}/gu) || []).length;
  const words = (text.replace(/\p{Script=Han}/gu, ' ').match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
  return { words: chinese + words, minutes: Math.max(1, Math.ceil(chinese / 350 + words / 220)) };
}
function publicPosts(posts, overrides = {}) {
  return posts.filter(post => !post.private && !post.password).map(post => {
    const file = path.basename(post.source);
    const display = overrides[file] || {};
    const text = plainText(post.content);
    return { file, title: display.title || post.title || file, originalTitle: post.title || '',
      url: '/' + post.path, date: post.date.format('YYYY-MM-DD'), text,
      summary: display.summary || text.slice(0, 110), ...readingStats(text),
      tags: post.tags.toArray().map(tag => tag.name), categories: post.categories.toArray().map(c => c.name) };
  });
}
function safeUrl(url) { return /^https?:\/\//i.test(String(url)) ? String(url) : null; }
function withHeadingAnchors(html) {
  const $ = load(String(html || ''), null, false);
  const used = new Set($('[id]').map((_, node) => $(node).attr('id')).get());
  $('h1,h2,h3,h4,h5,h6').each((_, node) => {
    if ($(node).attr('id')) return;
    const base = $(node).text().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
    let id = base, suffix = 2;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id); $(node).attr('id', id);
  });
  return $.html();
}
module.exports = { escape, plainText, readingStats, publicPosts, safeUrl, withHeadingAnchors };
