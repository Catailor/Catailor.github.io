'use strict';

const path = require('node:path');

// Keep the installed theme intact; Pug resolves this include from its layout directory.
hexo.extend.filter.register('before_generate', function () {
  const entry = path.relative(path.join(hexo.theme_dir, 'layout'),
    path.join(hexo.base_dir, 'layout/moonlit/index.pug')).replace(/\\/g, '/');
  hexo.theme.setView('index.pug', `include ${entry}`);
});

hexo.extend.helper.register('moonlit_posts', function () {
  const settings = this.site.data.moonlit || {};
  const descriptions = settings.posts || {};
  return this.site.posts.sort('-date').toArray().map(post => {
    const name = path.basename(post.source);
    const entry = descriptions[name] || {};
    const plain = this.strip_html(post.excerpt || post.content || '').replace(/\s+/g, ' ').trim();
    return {
      title: entry.title || post.title,
      summary: entry.summary || plain.slice(0, 100),
      kind: entry.kind || (post.categories.toArray().some(c => c.name === 'diary') ? 'life' : 'study'),
      topic: entry.topic || post.categories.toArray().map(c => c.name).join(' · ') || '随手记录',
      href: this.url_for(post.path),
      date: name === 'check_in.md' ? '随手记录' : this.date(post.date, 'YYYY.MM.DD'),
      cover: this.url_for(entry.cover || (entry.kind === 'life' ? '/img/moonlit/sunset.webp' : '/img/moonlit/notes.webp')),
      featured: name === settings.featured
    };
  }).sort((a, b) => Number(b.featured) - Number(a.featured));
});
