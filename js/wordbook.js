(() => {
  const root = document.getElementById('wordbook'); if (!root) return;
  const $ = id => document.getElementById(id), key = 'moonlit-word-review-v1';
  let words = [], marks = {}, limit = 20;
  try { const saved = JSON.parse(localStorage.getItem(key)); if (saved && typeof saved === 'object' && !Array.isArray(saved)) marks = saved; } catch (_) {}
  const el = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  function render() {
    const query = $('word-query').value.trim().normalize('NFKC').toLocaleLowerCase();
    const found = words.filter(w => (!$('word-review').checked || marks[w.key]) && `${w.word} ${w.reading} ${w.meanings.join(' ')}`.normalize('NFKC').toLocaleLowerCase().includes(query));
    $('word-list').replaceChildren();
    $('word-status').textContent = words.length ? `共收集 ${words.length} 个词语 · 当前 ${found.length} 个` : '词语本还空着。日记中填写完整的词语表并发布后，会自动收集到这里。';
    for (const word of found.slice(0, limit)) {
      const card = el('article', ''); card.className = 'wordbook-card';
      const header = el('header', ''), title = el('h2', word.word), reading = el('span', word.reading);
      const mark = el('button', marks[word.key] ? '还没记牢 ✓' : '标记待复习'); mark.type = 'button'; mark.setAttribute('aria-pressed', String(!!marks[word.key]));
      mark.addEventListener('click', () => {
        if (marks[word.key]) delete marks[word.key]; else marks[word.key] = true;
        try { localStorage.setItem(key, JSON.stringify(marks)); } catch (_) { $('word-status').textContent = '浏览器无法保存标记，本次浏览期间仍可使用。'; }
        if ($('word-review').checked) render(); else { mark.textContent = marks[word.key] ? '还没记牢 ✓' : '标记待复习'; mark.setAttribute('aria-pressed', String(!!marks[word.key])); }
      });
      header.append(title, reading, mark); card.append(header);
      const answer = el($('word-hide').checked ? 'details' : 'div', ''); answer.className = 'word-answer';
      if ($('word-hide').checked) answer.append(el('summary', '想好了吗？展开释义'));
      answer.append(el('p', word.meanings.join('；'))); if (word.example) answer.append(el('p', word.example)); card.append(answer);
      const sources = el('div', '记录于：'); sources.className = 'word-sources';
      for (const source of word.sources) { const a = el('a', source.date); a.href = source.url; a.title = source.title; sources.append(a); }
      card.append(sources); $('word-list').append(card);
    }
    $('word-more').hidden = found.length <= limit;
  }
  ['word-query', 'word-review', 'word-hide'].forEach(id => $(id).addEventListener('input', () => { limit = 20; render(); }));
  $('word-more').addEventListener('click', () => { limit += 20; render(); });
  $('word-status').textContent = '正在整理词语…';
  fetch('/notebook-words.json').then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => { words = data; render(); }).catch(() => { $('word-status').textContent = '词语暂时没加载成功，请刷新重试。'; });
})();
