'use strict';
const { readFileSync, existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { escape: e, readingStats, plainText, publicPosts, safeUrl, withHeadingAnchors, seriesPosts, wordbook } = require('../lib/notebook');

// Fail closed: ordinary Hexo posts are public, including their source on GitHub.
hexo.extend.filter.register('before_generate', () => {
  for (const post of [...hexo.locals.get('posts').toArray(), ...hexo.locals.get('pages').toArray()]) {
    if (post.private || post.password) throw new Error('私人文章不能放在 Hexo source 中，请使用 npm run private 的加密写作入口。');
  }
  const vault = path.join(hexo.source_dir, 'private');
  if (existsSync(vault)) {
    const allowed = new Set(['index.html', 'vault.json']);
    if (readdirSync(vault).some(name => !allowed.has(name))) throw new Error('source/private 只允许解锁页和加密 vault.json，不允许明文文章或附件。');
    if (existsSync(path.join(vault, 'vault.json'))) {
      require('../source/js/vault-crypto').validateEnvelope(JSON.parse(readFileSync(path.join(vault, 'vault.json'), 'utf8')));
    }
  }
}, 1);

hexo.extend.helper.register('notebook_stats', content => readingStats(plainText(content)));

hexo.extend.filter.register('after_post_render', data => {
  if (data.layout === 'post') {
    data.content = require('../lib/study-blocks.cjs').studyBlocks(data.content);
    data.content = withHeadingAnchors(data.content);
    const stats = readingStats(plainText(data.content));
    data.content = `<div class="notebook-reading" data-reading-article data-reading-minutes="${stats.minutes}" data-article-version="${stats.words}"><span>约 ${stats.words.toLocaleString('zh-CN')} 字</span><span>参考阅读时间 ${stats.minutes} 分钟</span></div>` + data.content;
  }
  return data;
}, 20);

hexo.extend.generator.register('notebook', function (locals) {
  const settings = locals.data.notebook || {};
  const posts = publicPosts(locals.posts.sort('-date').toArray(), locals.data.moonlit?.posts);
  const byFile = new Map(posts.map(post => [post.file, post]));
  const series = (settings.series || []).map(item => {
    if (!/^[a-z0-9-]+$/.test(item.id)) throw new Error('专题 id 只允许小写英文、数字和短横线');
    return { ...item, posts: seriesPosts(item, posts) };
  });
  const related = {};
  for (const [file, targets] of Object.entries(settings.related || {})) {
    if (!byFile.has(file)) throw new Error(`关联文章来源不存在：${file}`);
    related[byFile.get(file).url] = [...new Set(targets)].filter(target => target !== file).map(target => {
      if (!byFile.has(target)) throw new Error(`关联文章不存在：${target}`);
      const { title, url, summary } = byFile.get(target); return { title, url, summary };
    });
  }
  const routes = [];
  const page = (route, title, content) => routes.push({ path: route + '/index.html', layout: 'page',
    data: { title, content: `<div class="notebook-hub">${content}</div>`, top_img: false, aside: false, comments: false, type: 'notebook' } });
  const intro = (label, text) => `<p class="notebook-kicker">${e(label)}</p><p class="notebook-lead">${e(text)}</p>`;
  const articleList = items => `<ol class="notebook-sequence">${items.map(post => `<li><a href="${e(post.url)}"><strong>${e(post.title)}</strong><span>${e(post.summary)}</span><small>${post.minutes} 分钟 · ${e(post.date)}</small></a></li>`).join('')}</ol>`;

  page('topics', '学习专题', intro('LEARNING PATHS', '把零散的笔记连成一条线，沿着自己的节奏慢慢读。') +
    `<div class="notebook-grid">${series.map(item => `<a class="notebook-tile" href="/topics/${e(item.id)}/"><small>${item.posts.length} 篇手记</small><h2>${e(item.title)}</h2><p>${e(item.description)}</p><span>打开专题 ↗</span></a>`).join('')}</div>`);
  for (const item of series) {
    const months = [...new Set(item.posts.map(p => p.date.slice(0, 7)))].sort().reverse();
    const base = 'topics/' + item.id;
    const views = [{ route: base, posts: item.posts, month: '' }, ...months.map(month => ({ route: `${base}/${month}`, posts: item.posts.filter(p => p.date.startsWith(month)), month }))];
    for (const view of views) {
      const count = Math.max(1, Math.ceil(view.posts.length / 20));
      for (let n = 1; n <= count; n++) {
        const href = num => '/' + view.route + (num === 1 ? '/' : `/page/${num}/`);
        const nav = `<nav class="notebook-months" aria-label="按月浏览"><a href="/${base}/" ${!view.month ? 'aria-current="page"' : ''}>最近记录</a>${months.map(m => `<a href="/${base}/${m}/" ${view.month === m ? 'aria-current="page"' : ''}>${e(m)}</a>`).join('')}</nav>`;
        const pager = `<nav class="notebook-pagination" aria-label="翻页">${n > 1 ? `<a href="${href(n - 1)}">← 上一页</a>` : '<span></span>'}<span>第 ${n} / ${count} 页 · ${view.posts.length} 篇</span>${n < count ? `<a href="${href(n + 1)}">下一页 →</a>` : '<span></span>'}</nav>`;
        page(view.route + (n === 1 ? '' : `/page/${n}`), item.title, intro('LEARNING PATH', item.description) +
          `<div class="notebook-topic-actions"><a href="/topics/">← 所有专题</a>${item.id === 'japanese' ? '<a href="/words/">我的词语本 ↗</a>' : ''}</div>` + nav +
          (view.posts.length ? articleList(view.posts.slice((n - 1) * 20, n * 20)) + pager : '<p class="notebook-empty">新的学习记录会收在这里。</p>'));
      }
    }
  }
  const japaneseMembers = new Set((series.find(s => s.id === 'japanese')?.posts || []).map(p => p.file));
  const words = wordbook(posts.filter(p => p.categories.includes('日语学习') || japaneseMembers.has(p.file)));
  routes.push({ path: 'notebook-words.json', data: JSON.stringify(words) });
  page('words', '我的词语本', intro('WORDS', '从日语日记里收集词语，回来查找，也回来复习。') +
    '<a href="/topics/japanese/">← 日语学习日记</a><div id="wordbook"><div class="wordbook-controls"><label>查找词语<input id="word-query" type="search" placeholder="日语、假名或中文"></label><label><input id="word-review" type="checkbox"> 只看还没记牢的</label><label><input id="word-hide" type="checkbox"> 遮住释义，试着回想</label></div><p id="word-status" role="status"></p><div id="word-list"></div><button id="word-more" class="notebook-button" hidden>再看一些</button><p class="wordbook-hint">复习标记保存在当前浏览器中。</p></div><noscript>查词和复习需要启用 JavaScript；完整词语表仍可在日记里阅读。</noscript>');

  page('search', '找一篇手记', intro('SEARCH THE NOTEBOOK', '搜索标题、正文或标签。试试「协方差」「Q-learning」或你记得的一句话。') +
    `<form id="notebook-search" role="search"><label class="sr-only" for="note-query">搜索手记</label><input id="note-query" type="search" placeholder="输入关键词…" maxlength="150" autocomplete="off"><button type="submit">搜索</button></form><p id="search-status" role="status" aria-live="polite">输入关键词开始搜索。</p><div id="search-results"></div><button id="search-more" class="notebook-button" hidden>显示更多结果</button><noscript>搜索需要启用 JavaScript，也可以<a href="/archives/">浏览归档</a>。</noscript>`);
  const about = settings.about || {};
  const now = settings.now || {};
  const currentNotes = now.learning || now.goal ? '<section class="notebook-about-now"><h2>最近的我</h2>' + (now.learning ? '<h3>最近在学</h3><p>' + e(now.learning) + '</p>' : '') + (now.goal ? '<h3>接下来想做</h3><p>' + e(now.goal) + '</p>' : '') + '</section>' : '';
  page('about', '关于我', intro('HELLO, I AM CATAILOR', about.intro || '欢迎来到我的个人小站。') +
    `<div class="notebook-about"><img src="/img/moonlit/avatar.webp" alt="Catailor 的头像" width="112" height="112"><div><h2>Catailor</h2>${(about.paragraphs || []).map(p => `<p>${e(p)}</p>`).join('')}<a class="notebook-button" href="https://github.com/catailor" target="_blank" rel="noopener noreferrer">去 GitHub 看看 ↗</a></div></div>${currentNotes}<h2>在这里可以读到</h2><div class="notebook-grid">${series.map(s => `<a class="notebook-tile" href="/topics/${e(s.id)}/"><h3>${e(s.title)}</h3><p>${e(s.description)}</p></a>`).join('')}</div>`);
  const friends = settings.friends || [];
  page('friends', '友链', intro('NEIGHBORS & FRIENDS', '互联网很大，能遇见认真记录的人，是一件很好的事。') +
    (friends.length ? `<div class="notebook-grid">${friends.map(friend => {
      const url = safeUrl(friend.url); if (!url) throw new Error('友链地址必须使用 http 或 https');
      return `<a class="notebook-tile" href="${e(url)}" target="_blank" rel="noopener noreferrer"><h2>${e(friend.name)}</h2><p>${e(friend.description)}</p><span>去坐坐 ↗</span></a>`;
    }).join('')}</div>` : '<div class="notebook-empty"><span>✧</span><h2>留一个位置，等下一次相遇。</h2><p>友链正在慢慢收集。</p></div>'));
  const moments = [...(settings.moments || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  page('moments', '碎碎念', intro('LITTLE MOMENTS', '不必每次都写成文章，也可以只记下一句话。') +
    (moments.length ? `<div class="notebook-moments">${moments.map(moment => `<article><time>${e(moment.date)}</time><p>${e(moment.text).replace(/\n/g, '<br>')}</p>${moment.tag ? `<span>${e(moment.tag)}</span>` : ''}</article>`).join('')}</div>` : '<div class="notebook-empty"><span>☾</span><h2>今天，有什么想记下来？</h2><p>第一条碎碎念，留给下一次灵感。</p></div>'));
  page('random', '随机漫游', intro('A SMALL DETOUR', '偶尔不按顺序，翻到一篇意料之外的手记。') +
    '<div class="notebook-empty"><span>✧</span><h2>下一页，会遇见什么？</h2><button class="notebook-button" data-random-post>带我随便逛逛 ↗</button><p data-random-status role="status"></p><noscript><a href="/archives/">浏览所有手记</a></noscript></div>');

  routes.push({ path: 'notebook-index.json', data: JSON.stringify(posts) });
  routes.push({ path: 'notebook-links.json', data: JSON.stringify({
    posts: posts.map(({ title, url }) => ({ title, url })), related,
    series: series.map(s => ({ title: s.title, url: `/topics/${s.id}/`, posts: s.posts.map(({ title, url }) => ({ title, url })) }))
  }) });
  routes.push({ path: 'js/vendor/markdown-it.min.js', data: readFileSync(require.resolve('markdown-it/browser')) });
  return routes;
});
