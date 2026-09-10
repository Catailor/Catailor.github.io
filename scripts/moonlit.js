'use strict';

const path = require('node:path');
const { plainText } = require('../lib/notebook');

// Keep the installed theme intact; Pug resolves this include from its layout directory.
hexo.extend.filter.register('before_generate', function () {
  for (const name of ['index', 'post', 'archive', 'tag', 'category', 'page']) {
    const entry = path.relative(path.join(hexo.theme_dir, 'layout'),
      path.join(hexo.base_dir, `layout/moonlit/${name}.pug`)).replace(/\\/g, '/');
    hexo.theme.setView(`${name}.pug`, `include ${entry}`);
  }
});

hexo.extend.helper.register('moonlit_note', function (post) {
  const name = path.basename(post.source || '');
  const entry = this.site.data.moonlit?.posts?.[name] || {};
  const hash = [...name].reduce((sum, char) => sum + char.codePointAt(0), 0);
  const kind = entry.kind || (post.categories?.toArray().some(c => c.name === 'diary') ? 'life' : 'study');
  const summary = plainText(post.excerpt || post.content).slice(0, 100);
  return { title: entry.title || post.title, summary: entry.summary || plainText(post.description) || summary,
    topic: entry.topic || post.topic || post.categories?.toArray().map(c => c.name).join(' · ') || '随手记录', kind,
    art: ['orbit', 'grid', 'wave', 'petal', 'steps', 'constellation'][hash % 6],
    symbol: entry.symbol || post.symbol || (kind === 'life' ? ['☾', '✧', '❋', '❀', '⌁', '✦'] : ['∑', '∞', 'π', '✧', '↗', '∴'])[hash % 6],
    cover: entry.cover ? this.url_for(entry.cover) : null,
    ...this.notebook_stats(post.content) };
});

hexo.extend.helper.register('moonlit_posts', function () {
  const settings = this.site.data.moonlit || {};
  return this.site.posts.sort('-date').toArray().map(post => {
    const name = path.basename(post.source);
    return {
      href: this.url_for(post.path),
      date: name === 'check_in.md' ? '随手记录' : this.date(post.date, 'YYYY.MM.DD'),
      ...this.moonlit_note(post),
      featured: name === settings.featured
    };
  }).sort((a, b) => Number(b.featured) - Number(a.featured));
});
