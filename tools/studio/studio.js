(() => {
  const $ = id => document.getElementById(id);
  let token = '', current = null, posts = [], dirty = false, saving = null, timer, previewTimer, previewVersion = 0, reviewed = null, publishing = false;
  const today = new Date(); $('new-day').value = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const status = text => $('save-status').textContent = text;
  async function api(route, data) {
    const response = await fetch('/api/' + route, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Token': token }, body: JSON.stringify(data) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失败'); return result;
  }
  function list() {
    const q = $('filter').value.toLocaleLowerCase(); $('post-list').replaceChildren();
    for (const post of posts.filter(p => `${p.title} ${p.date}`.toLocaleLowerCase().includes(q))) {
      const button = document.createElement('button'), title = document.createElement('strong'), meta = document.createElement('small');
      title.textContent = post.title || '未命名草稿'; meta.textContent = `${post.draft ? '草稿' : '文章'} · ${post.date}`;
      if (post.id === current?.id) button.setAttribute('aria-current', 'page'); button.append(title, meta);
      button.disabled = publishing; button.addEventListener('click', () => attempt(async () => { await save(); open(await api('post?id=' + encodeURIComponent(post.id))); })); $('post-list').append(button);
    }
  }
  const refresh = async () => { posts = await api('posts'); list(); };
  async function attempt(action) { try { await action(); } catch (e) { status(e.message); } }
  function open(post) {
    current = post; dirty = false; $('editor').hidden = false; $('empty').hidden = true;
    ['title','date','summary','body'].forEach(key => $(key).value = post[key]);
    $('document-state').textContent = post.draft ? '本机草稿 · 不会自动公开' : '编辑文章 · 保存后需发布才更新网站';
    $('save').disabled = $('publish').disabled = publishing;
    status('已读取本机内容'); list(); preview();
  }
  async function save() {
    clearTimeout(timer);
    if (saving) { await saving; if (dirty) return save(); return; }
    if (!dirty || !current) return;
    if (publishing) throw new Error('正在发布，请稍后编辑');
    const input = { id: current.id, revision: current.revision }; ['title','date','summary','body'].forEach(key => input[key] = $(key).value);
    dirty = false; status('正在保存到本机…');
    saving = api('save', input).then(result => { current.revision = result.revision; current.title = input.title; current.date = input.date; status('已保存到本机 · ' + new Date().toLocaleTimeString()); }).catch(error => { dirty = true; throw error; }).finally(() => { saving = null; });
    await saving; await refresh();
    if (dirty) timer = setTimeout(() => attempt(save), 1000);
  }
  function changed() {
    dirty = true; status('有未保存的修改…'); clearTimeout(timer); timer = setTimeout(() => attempt(save), 1200);
    clearTimeout(previewTimer); previewTimer = setTimeout(preview, 300);
  }
  async function preview() {
    const version = ++previewVersion;
    try {
      const result = await api('preview', { body: $('body').value }); if (version !== previewVersion) return;
      $('preview').srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/katex/katex.min.css"><style>body{font:16px/1.9 'Microsoft YaHei',sans-serif;padding:14px 22px;color:#383244;overflow-wrap:anywhere}h1,h2,h3{font-family:SimSun,serif;line-height:1.6}h2{border-bottom:1px solid #e5dfeb;padding-bottom:8px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #e5dfeb;padding:7px}pre,.katex-display{overflow:auto;background:#f5f3f8;padding:12px}img{max-width:100%;border-radius:8px}blockquote{margin-left:0;border-left:3px solid #bba8cf;padding-left:16px;color:#716979}a{color:#76638e}</style></head><body>${result.html}</body></html>`;
    } catch (e) { status(e.message); }
  }
  ['title','date','summary','body'].forEach(id => $(id).addEventListener('input', changed));
  $('filter').addEventListener('input', list);
  ['quick','full','post'].forEach(mode => $('new-' + mode).addEventListener('click', () => attempt(async () => { await save(); open(await api('new', { mode, date: $('new-day').value })); await refresh(); })));
  $('save').addEventListener('click', () => attempt(save));
  const insert = text => { const field = $('body'); field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end'); field.focus(); changed(); };
  $('add-heading').addEventListener('click', () => insert('\n\n## 小标题\n\n'));
  $('word-open').addEventListener('click', () => $('word-dialog').showModal());
  $('word-close').addEventListener('click', () => $('word-dialog').close());
  $('word-form').addEventListener('submit', event => {
    event.preventDefault(); const cell = id => $(id).value.trim().replace(/\|/g, '｜').replace(/[\r\n]/g, ' ');
    const row = `| ${cell('word')} | ${cell('kana')} | ${cell('pos')} | ${cell('meaning')} | ${cell('example')} |`;
    let body = $('body').value;
    const table = /(^\|\s*单词\s*\|[^\n]*\n\|[^\n]*\n)(?:\|[^\n]*(?:\n|$))*/m;
    const match = body.match(table);
    if (match) body = body.slice(0, match.index) + match[0].trimEnd() + '\n' + row + '\n' + body.slice(match.index + match[0].length);
    else body += '\n\n## 今日词语\n\n| 单词 | 读音（假名） | 词性 | 中文意思 | 例句与用法 |\n| --- | --- | --- | --- | --- |\n' + row + '\n';
    $('body').value = body; $('word-form').reset(); $('word-dialog').close(); changed();
  });
  $('image').addEventListener('change', () => attempt(async () => {
    const file = $('image').files[0]; if (!file) return; if (file.size > 5000000) throw new Error('图片请小于 5 MB');
    const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
    const result = await api('upload', { data }); insert(`\n\n![图片说明](${result.url})\n\n`); $('image').value = '';
  }));
  async function review(isPrivate = false) {
    await save(); reviewed = await api('review', { id: current?.id, private: isPrivate });
    $('review-title').textContent = reviewed.title; $('review-summary').textContent = reviewed.summary;
    $('review-category').textContent = '发布到：' + reviewed.category; $('review-assets').textContent = `随文配图：${reviewed.assets.length} 张`;
    $('review').showModal();
  }
  $('publish').addEventListener('click', () => attempt(() => review()));
  $('private-publish').addEventListener('click', () => attempt(() => review(true)));
  $('review-close').addEventListener('click', () => $('review').close());
  $('review-confirm').addEventListener('click', () => attempt(async () => {
    $('review-confirm').disabled = true;
    try { await api('publish', { items: [{ id: reviewed.id, revision: reviewed.revision }] }); $('review').close(); await poll(); } finally { $('review-confirm').disabled = false; }
  }));
  let lastState = '';
  async function poll() {
    try {
      const job = await api('status'); publishing = ['building','uploading'].includes(job.state);
      $('publication-status').textContent = job.message;
      ['save','publish'].forEach(id => $(id).disabled = publishing || !current);
      ['new-quick','new-full','new-post','private-publish'].forEach(id => $(id).disabled = publishing);
      ['title','date','summary','body'].forEach(id => $(id).disabled = publishing);
      document.querySelectorAll('.writing-tools button').forEach(b => b.disabled = publishing); $('image').disabled = publishing;
      if (lastState !== job.state) {
        lastState = job.state; await refresh();
        if (job.state === 'deploying' && current?.draft && !posts.some(p => p.id === current.id) && !dirty) {
          const id = current.id.replace('source/_drafts/', 'source/_posts/'); if (posts.some(p => p.id === id)) open(await api('post?id=' + encodeURIComponent(id)));
        }
      }
    } catch (e) { $('publication-status').textContent = '写作服务暂时无法连接；当前未保存文字仍在编辑框中。'; }
  }
  addEventListener('beforeunload', e => { if (dirty || saving) { e.preventDefault(); e.returnValue = ''; } });
  attempt(async () => { const session = await api('session'); token = session.token; $('private-link').href = session.privateUrl; await refresh(); await poll(); setInterval(poll, 6000); });
})();
