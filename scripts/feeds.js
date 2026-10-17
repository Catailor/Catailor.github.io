'use strict';
// Atom feed, sitemap, robots.txt and redirect pages for renamed posts.
// Kept dependency-free so the build does not need extra Hexo plugins.
const { escape: e, plainText, summaryText } = require('../lib/notebook');

const absolute = (config, route) => new URL(String(route || '').replace(/^\//, '').replace(/index\.html$/, ''), config.url.replace(/\/?$/, '/')).href;
const iso = date => date.toDate().toISOString();

hexo.extend.generator.register('moonlit_feeds', function (locals) {
  const config = this.config;
  const posts = locals.posts.sort('-date').toArray().filter(post => post.published !== false);
  const site = config.url.replace(/\/?$/, '/');
  const entries = posts.slice(0, 20).map(post => {
    const url = absolute(config, post.path);
    const summary = plainText(post.description) || summaryText(post.content);
    const categories = [...post.categories.toArray(), ...post.tags.toArray()].map(term => `<category term="${e(term.name)}"/>`).join('');
    return `<entry><title>${e(post.title)}</title><link href="${e(url)}"/><id>${e(url)}</id><published>${iso(post.date)}</published><updated>${iso(post.updated || post.date)}</updated><summary>${e(summary)}</summary><content type="html">${e(post.content)}</content>${categories}</entry>`;
  }).join('\n');
  const updated = posts.length ? iso(posts[0].updated || posts[0].date) : new Date().toISOString();
  const atom = `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${e(config.language || 'zh-CN')}"><title>${e(config.title)}</title><subtitle>${e(config.description || '')}</subtitle><link href="${e(site)}atom.xml" rel="self"/><link href="${e(site)}"/><id>${e(site)}</id><updated>${updated}</updated><author><name>${e(config.author || '')}</name></author>\n${entries}\n</feed>\n`;

  const pages = locals.pages.toArray().filter(page => page.layout !== false && !/^(404|private|companion)/.test(page.path));
  const routes = [
    { loc: site, lastmod: updated },
    ...posts.map(post => ({ loc: absolute(config, post.path), lastmod: iso(post.updated || post.date) })),
    ...pages.map(page => ({ loc: absolute(config, page.path), lastmod: iso(page.updated || page.date) })),
    ...['archives/', 'topics/', 'about/', 'moments/', 'search/', 'words/'].map(route => ({ loc: site + route }))
  ];
  const seen = new Set();
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.filter(r => !seen.has(r.loc) && seen.add(r.loc)).map(r => `<url><loc>${e(r.loc)}</loc>${r.lastmod ? `<lastmod>${r.lastmod}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
  const robots = `User-agent: *\nAllow: /\nDisallow: /private/\nDisallow: /companion/\n\nSitemap: ${site}sitemap.xml\n`;

  // Old addresses keep working after a post gets a readable link name.
  const redirects = [];
  for (const post of posts) {
    for (const from of [].concat(post.redirect_from || [])) {
      const route = String(from).replace(/^\/+/, '').replace(/(?:index\.html)?$/, '');
      if (!route || route.includes('..')) continue;
      const target = '/' + post.path.replace(/^\/+/, '').replace(/index\.html$/, '');
      redirects.push({ path: route.replace(/\/?$/, '/') + 'index.html', data: `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${e(post.title)}</title><link rel="canonical" href="${e(absolute(config, post.path))}"><meta name="robots" content="noindex"><link rel="icon" href="/img/favicon.svg" type="image/svg+xml"><meta http-equiv="refresh" content="0; url=${e(target)}"></head><body><p>这篇手记搬到了新地址：<a href="${e(target)}">${e(post.title)}</a></p></body></html>` });
    }
  }
  return [
    { path: 'atom.xml', data: atom },
    { path: 'sitemap.xml', data: sitemap },
    { path: 'robots.txt', data: robots },
    ...redirects
  ];
});
