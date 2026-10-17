'use strict';

const path = require('node:path');
const { plainText, summaryText } = require('../lib/notebook');

// Keep the installed theme intact; Pug resolves this include from its layout directory.
hexo.extend.filter.register('before_generate', function () {
  for (const name of ['index', 'post', 'archive', 'tag', 'category', 'page']) {
    const entry = path.relative(path.join(hexo.theme_dir, 'layout'),
      path.join(hexo.base_dir, `layout/moonlit/${name}.pug`)).replace(/\\/g, '/');
    hexo.theme.setView(`${name}.pug`, `include ${entry}`);
  }
});

const LIFE_CATEGORIES = new Set(['diary', '日常', '日记', '生活']);
const KINDS = new Set(['study', 'life', 'moment']);
const SYMBOLS = { study: ['∑', '∞', 'π', '∂', '↗', '∴'], life: ['¶', '§', '&', '~', '°', '※'], moment: ['·', '“', '~', '¶', '°', '※'] };

// Front matter wins; source/_data/moonlit.yml posts.<file> is a legacy fallback.
function noteOf(post, data, urlFor) {
  const name = path.basename(post.source || '');
  const legacy = post.studio_edited ? {} : (data.moonlit?.posts?.[name] || {});
  const categories = post.categories?.toArray().map(c => c.name) || [];
  const kind = KINDS.has(post.kind) ? post.kind : KINDS.has(legacy.kind) ? legacy.kind
    : categories.some(c => LIFE_CATEGORIES.has(c)) ? 'life' : 'study';
  const hash = [...name].reduce((sum, char) => sum + char.codePointAt(0), 0);
  const series = data.notebook?.series || [];
  const memberships = series.filter(s => s.posts?.includes(name));
  const japaneseSeries = series.find(s => s.id === 'japanese');
  const cover = post.cover || legacy.cover;
  return {
    file: name, kind, categories,
    title: legacy.title || post.title || name,
    summary: legacy.summary || plainText(post.description) || summaryText(post.excerpt || post.content),
    topic: post.topic || legacy.topic || memberships.map(s => s.title).join(' · ') || categories.join(' · ') || '随手记录',
    art: ['orbit', 'grid', 'wave', 'petal', 'steps', 'constellation'][hash % 6],
    symbol: post.symbol || legacy.symbol || SYMBOLS[kind][hash % 6],
    japanese: japaneseSeries?.posts ? japaneseSeries.posts.includes(name) : categories.includes('日语学习'),
    cover: cover ? urlFor(cover) : null,
    featured: Boolean(post.featured) || name === data.moonlit?.featured
  };
}

hexo.extend.helper.register('moonlit_note', function (post) {
  return { ...noteOf(post, this.site.data, value => this.url_for(value)), ...this.notebook_stats(post.content) };
});

function listing(ctx) {
  return ctx.site.posts.sort('-date').toArray().map(post => ({
    href: ctx.url_for(post.path), iso: post.date.toISOString(),
    date: path.basename(post.source) === 'check_in.md' ? '随手记录' : ctx.date(post.date, 'YYYY.MM.DD'),
    day: ctx.date(post.date, 'MM.DD'), year: ctx.date(post.date, 'YYYY'),
    ...ctx.moonlit_note(post), html: post.kind === 'moment' ? post.content : ''
  }));
}

// Home notes: moments live on their own shelf, featured notes come first.
hexo.extend.helper.register('moonlit_posts', function () {
  return listing(this).filter(p => p.kind !== 'moment').sort((a, b) => Number(b.featured) - Number(a.featured));
});

// Moments: short posts marked kind: moment, plus legacy one-liners from notebook.yml.
hexo.extend.helper.register('moonlit_moments', function (limit = Infinity) {
  const fromPosts = listing(this).filter(p => p.kind === 'moment').map(p => ({ date: p.iso.slice(0, 10), title: p.title, text: plainText(p.html), href: p.href }));
  const fromData = (this.site.data.notebook?.moments || []).map(m => ({ date: String(m.date), title: '', text: String(m.text || ''), tag: m.tag }));
  return [...fromPosts, ...fromData].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
});

const inSeries = (s, p) => s.posts ? s.posts.includes(p.file) : (p.categories || []).includes(s.category);
const newest = (a, b) => String(b.iso || b.date).localeCompare(String(a.iso || a.date));

// Series pinned to the homepage (homepage: true; the Japanese diary by default), with their latest three entries.
hexo.extend.helper.register('moonlit_home_series', function (posts) {
  return (this.site.data.notebook?.series || []).filter(s => s.homepage ?? s.id === 'japanese')
    .sort((a, b) => (a.homeOrder || 0) - (b.homeOrder || 0))
    .map(s => ({ ...s, entries: posts.filter(p => inSeries(s, p)).sort(newest).slice(0, 3) }));
});

// The homepage shelf shows every series; pinned ones lead and get the dark card.
hexo.extend.helper.register('moonlit_shelf', function (posts) {
  return (this.site.data.notebook?.series || []).map(s => {
    const entries = posts.filter(p => inSeries(s, p)).sort(newest);
    return { ...s, pinned: Boolean(s.homepage ?? s.id === 'japanese'), count: entries.length, entries: entries.slice(0, 3) };
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (a.homeOrder || 0) - (b.homeOrder || 0));
});

hexo.extend.helper.register('moonlit_since', function () {
  const first = this.site.posts.sort('date').first();
  return first ? first.date.year() : new Date().getFullYear();
});

