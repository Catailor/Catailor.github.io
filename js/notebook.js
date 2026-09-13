(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  let linksRequest;
  const links = () => linksRequest ||= fetch('/notebook-links.json').then(response => { if (!response.ok) throw new Error(); return response.json(); }).catch(error => { linksRequest = null; throw error; });
  const motion = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  function init() {
    function backTarget() {
      const samePage = url => url.pathname.replace(/index\.html$/, '') === location.pathname.replace(/index\.html$/, '') && url.search === location.search;
      // Skip article-heading history entries so “back” leaves the article in one click.
      if (window.navigation?.currentEntry) {
        const entries = window.navigation.entries(), current = window.navigation.currentEntry.index;
        for (let i = current - 1; i >= 0; i--) {
          if (!entries[i]?.url) return null;
          const url = new URL(entries[i].url);
          if (url.origin !== location.origin) return null;
          if (!samePage(url)) return { href: url.href, steps: i - current };
        }
        return null;
      }
      // Older browsers still get a useful same-site destination, without leaving the blog.
      try {
        const url = new URL(document.referrer);
        if (url.origin === location.origin && !samePage(url)) return { href: url.href, steps: !location.hash && history.length > 1 ? -1 : 0 };
      } catch (_) {}
      return null;
    }
    document.querySelectorAll('[data-article-back]').forEach(link => {
      const target = backTarget();
      if (target) { link.href = target.href; link.textContent = '← 返回上一页'; }
      link.addEventListener('click', event => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const destination = backTarget();
        if (destination?.steps) { event.preventDefault(); history.go(destination.steps); }
      });
    });
    const form = $('#notebook-search');
    if (form) {
      const input = $('#note-query'), results = $('#search-results'), status = $('#search-status'), more = $('#search-more');
      let indexRequest, current = 0, matches = [], limit = 12;
      function snippet(text, tokens) {
        const lower = text.toLocaleLowerCase();
        const positions = tokens.map(token => lower.indexOf(token)).filter(n => n >= 0);
        const offset = positions.length ? Math.max(0, Math.min(...positions) - 40) : 0;
        return (offset ? '…' : '') + text.slice(offset, offset + 180) + (text.length > offset + 180 ? '…' : '');
      }
      function highlight(node, text, tokens) {
        const expression = new RegExp(tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
        let end = 0;
        for (const match of text.matchAll(expression)) {
          node.append(document.createTextNode(text.slice(end, match.index)), make('mark', match[0]));
          end = match.index + match[0].length;
        }
        node.append(document.createTextNode(text.slice(end)));
      }
      function render(tokens) {
        results.replaceChildren();
        for (const post of matches.slice(0, limit)) {
          const card = make('article', undefined, 'notebook-result'), title = make('h2'), anchor = make('a');
          anchor.href = post.url; highlight(anchor, post.title, tokens); title.append(anchor);
          const excerpt = make('p'); highlight(excerpt, snippet(post.text, tokens), tokens);
          card.append(title, excerpt, make('small', `${post.date} · ${post.minutes} 分钟`)); results.append(card);
        }
        more.hidden = matches.length <= limit;
        status.textContent = matches.length ? `找到 ${matches.length} 篇手记，显示 ${Math.min(limit, matches.length)} 篇。` : '没有找到匹配的手记，试试更短的关键词。';
      }
      async function search() {
        const id = ++current, query = input.value.trim().slice(0, 150);
        const tokens = [...new Set(query.toLocaleLowerCase().split(/\s+/).filter(Boolean))].slice(0, 12);
        history.replaceState(null, '', query ? `?q=${encodeURIComponent(query)}` : location.pathname);
        results.replaceChildren(); more.hidden = true;
        if (!tokens.length) { status.textContent = '输入关键词开始搜索。'; return; }
        status.textContent = '正在翻找手记…';
        try {
          indexRequest ||= fetch('/notebook-index.json').then(response => { if (!response.ok) throw new Error(); return response.json(); }).catch(error => { indexRequest = null; throw error; });
          const posts = await indexRequest; if (id !== current) return;
          matches = posts.map(post => {
            const title = `${post.title} ${post.originalTitle}`.toLocaleLowerCase();
            const tags = [...post.tags, ...post.categories].join(' ').toLocaleLowerCase();
            const body = post.text.toLocaleLowerCase();
            const found = tokens.every(token => title.includes(token) || tags.includes(token) || body.includes(token));
            return { ...post, score: found ? tokens.reduce((sum, token) => sum + (title.includes(token) ? 8 : 0) + (tags.includes(token) ? 4 : 0) + (body.includes(token) ? 1 : 0), 0) : 0 };
          }).filter(post => post.score).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date));
          limit = 12; render(tokens);
        } catch (_) { if (id === current) status.textContent = '搜索索引暂时没加载成功，请再次搜索重试。'; }
      }
      let debounce;
      input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(search, 180); });
      form.addEventListener('submit', event => { event.preventDefault(); clearTimeout(debounce); search(); });
      more.addEventListener('click', () => { limit += 12; render([...new Set(input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean))].slice(0, 12)); });
      input.value = new URLSearchParams(location.search).get('q')?.slice(0, 150) || '';
      if (input.value) search();
    }
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,textarea,select,[contenteditable="true"]')) {
        event.preventDefault(); if (form) $('#note-query').focus(); else location.assign('/search/');
      }
    });
    document.querySelectorAll('[data-random-post]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true; const status = $('[data-random-status]');
      try {
        const items = (await links()).posts.filter(post => post.url !== location.pathname);
        if (!items.length) { if (status) status.textContent = '暂时没有其他手记，晚点再来看看。'; button.disabled = false; return; }
        const index = Math.floor(Math.random() * items.length); location.assign(items[index].url);
      } catch (_) { if (status) status.textContent = '暂时没能打开手记，请重试。'; button.disabled = false; }
    }));

    const article = $('#article-container');
    if (article && $('[data-reading-article]')) {
      const path = decodeURI(location.pathname).replace(/index\.html$/, '');
      links().then(data => {
        const decode = value => decodeURI(value).replace(/index\.html$/, '');
        const series = data.series.filter(item => item.posts.some(post => decode(post.url) === path));
        const relatedKey = Object.keys(data.related).find(url => decode(url) === path);
        const related = data.related[relatedKey] || [];
        if (!series.length && !related.length) return;
        const panel = make('section', undefined, 'notebook-connections'); panel.setAttribute('aria-label', '继续阅读');
        for (const item of series) {
          const section = make('div'), heading = make('h2'), link = make('a', item.title); link.href = item.url;
          heading.append(make('small', '所属专题 · '), link); section.append(heading);
          const list = make('ol');
          const index = item.posts.findIndex(post => decode(post.url) === path);
          for (const post of item.posts.filter((post, i) => Math.abs(i - index) === 1)) {
            const li = make('li'), a = make('a', (item.posts.indexOf(post) < index ? '上一篇 · ' : '下一篇 · ') + post.title); a.href = post.url;
            if (decode(post.url) === path) { a.setAttribute('aria-current', 'page'); a.append(' · 正在读'); }
            li.append(a); list.append(li);
          }
          section.append(list); panel.append(section);
          document.querySelector('.letter-japanese-neighbors')?.remove();
        }
        if (related.length) {
          const section = make('div'); section.append(make('h2', '接下来可以读'));
          for (const post of related) {
            const a = make('a', undefined, 'notebook-related'); a.href = post.url;
            a.append(make('strong', post.title), make('span', post.summary)); section.append(a);
          }
          panel.append(section);
        }
        article.after(panel);
      }).catch(() => {});
      if (document.body.classList.contains('letter-short')) return;
      const key = 'moonlit-reading-v1', version = $('[data-reading-article]').dataset.articleVersion;
      let records = {}, previous, frame = false;
      try { records = JSON.parse(localStorage.getItem(key)) || {}; } catch (_) {}
      if (typeof records !== 'object' || Array.isArray(records)) records = {};
      previous = records[path];
      const meter = make('div', undefined, 'notebook-progress'); meter.setAttribute('aria-hidden', 'true'); document.body.append(meter);
      const position = () => {
        const rect = article.getBoundingClientRect();
        const range = Math.max(1, article.offsetHeight - innerHeight + 100);
        return Math.max(0, Math.min(1, (100 - rect.top) / range));
      };
      const save = () => {
        const ratio = position();
        if (ratio <= .01) return;
        records[path] = { ratio, version, time: Date.now() };
        records = Object.fromEntries(Object.entries(records).sort((a,b) => (b[1]?.time || 0) - (a[1]?.time || 0)).slice(0, 100));
        try { localStorage.setItem(key, JSON.stringify(records)); } catch (_) {}
      };
      const update = () => {
        const ratio = position(); meter.style.width = `${ratio * 100}%`;
        frame = false;
        document.dispatchEvent(new CustomEvent('notebook:progress', { detail: ratio }));
      };
      if (!location.hash && previous?.version === version && Number.isFinite(previous.ratio) && previous.ratio > .05 && previous.ratio < .95) {
        const prompt = make('aside', undefined, 'notebook-resume'); prompt.setAttribute('aria-label', '继续上次阅读');
        const resume = make('button', `继续上次阅读 · ${Math.round(previous.ratio * 100)}%`), dismiss = make('button', '从头阅读');
        resume.type = dismiss.type = 'button';
        resume.addEventListener('click', () => {
          const top = scrollY + article.getBoundingClientRect().top - 100 + previous.ratio * Math.max(1, article.offsetHeight - innerHeight + 100);
          scrollTo({ top, behavior: motion() }); prompt.remove();
        });
        dismiss.addEventListener('click', () => { delete records[path]; try { localStorage.setItem(key, JSON.stringify(records)); } catch (_) {} prompt.remove(); });
        prompt.append(resume, dismiss); document.body.append(prompt);
      }
      addEventListener('scroll', () => { if (!frame) { frame = true; requestAnimationFrame(update); } }, { passive: true });
      addEventListener('resize', update); addEventListener('pagehide', save);
      document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
      setInterval(save, 5000); update();
    }
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
