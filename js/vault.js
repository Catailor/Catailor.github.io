(() => {
  'use strict';
  const $ = id => document.getElementById(id), editor = document.body.dataset.editor === 'true';
  const endpoint = editor ? '/api/vault' : '/private/vault.json';
  let envelope = null, bundle = null, password = '', selected = null, etag = '', token = '', busy = false, dirty = false, activity = Date.now();
  const md = window.markdownit({ html: false, linkify: false, breaks: true });
  md.renderer.rules.image = () => '<span>〔私人图片暂不支持〕</span>';
  const originalLink = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => { tokens[idx].attrSet('rel', 'noreferrer noopener'); tokens[idx].attrSet('target', '_blank'); return originalLink(tokens, idx, options, env, self); };
  function status(text) { $('vault-status').textContent = text; }
  function setBusy(value) { busy = value; document.querySelectorAll('button').forEach(button => { button.disabled = value; }); }
  function clearEditor() { $('vault-edit-form').reset(); $('vault-editor').hidden = true; dirty = false; }
  function lock() {
    if (busy) return;
    bundle = null; password = ''; selected = null; dirty = false;
    $('vault-list').replaceChildren(); $('vault-article').replaceChildren(); $('vault-open').hidden = true;
    $('vault-gate').hidden = false; $('vault-lock').hidden = true; clearEditor();
    $('vault-password').value = ''; $('vault-confirm').value = ''; $('vault-rekey').reset();
    status('手记已锁定。');
  }
  function show(id) {
    selected = id; const note = bundle.notes.find(n => n.id === id), article = $('vault-article'); article.replaceChildren();
    if (!note) { article.textContent = editor ? '还没有私人手记，点击「新手记」开始。' : '这里暂时没有手记。'; return; }
    const title = document.createElement('h1'); title.textContent = note.title;
    const date = document.createElement('p'); date.className = 'hint'; date.textContent = note.date;
    const body = document.createElement('div'); body.innerHTML = md.render(note.body);
    article.append(title, date, body);
    if (editor) { const edit = document.createElement('button'); edit.textContent = '编辑这篇'; edit.addEventListener('click', () => editNote(note)); article.append(edit); }
    [...$('vault-list').children].forEach(button => { if (button.dataset.id === id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  }
  function render() {
    $('vault-gate').hidden = true; $('vault-open').hidden = false; $('vault-lock').hidden = false;
    $('vault-new').hidden = !editor; $('vault-settings').hidden = !editor;
    $('vault-count').textContent = `${bundle.notes.length} 篇私人手记`;
    $('vault-list').replaceChildren();
    for (const note of [...bundle.notes].sort((a,b) => b.date.localeCompare(a.date))) {
      const button = document.createElement('button'); button.textContent = note.title; button.dataset.id = note.id;
      button.addEventListener('click', () => { if (dirty && !confirm('放弃尚未保存的编辑？')) return; clearEditor(); show(note.id); });
      $('vault-list').append(button);
    }
    show(selected || bundle.notes[0]?.id); activity = Date.now();
  }
  function editNote(note) {
    if (dirty && !confirm('放弃尚未保存的编辑？')) return;
    selected = note?.id || null; $('vault-title').value = note?.title || '';
    const now = new Date(); const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    $('vault-date').value = note?.date || localDate; $('vault-body').value = note?.body || '';
    $('vault-delete').hidden = !note; $('vault-editor').hidden = false; dirty = false;
    $('vault-title').focus(); $('vault-editor').scrollIntoView({ block: 'start' });
  }
  async function persist(nextBundle, nextPassword = password) {
    const ciphertext = await MoonVault.encrypt(nextBundle, nextPassword);
    const response = await fetch(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Vault-Token': token, 'If-Match': etag }, body: JSON.stringify(ciphertext) });
    if (response.status === 409) throw new Error('文件已被另一个编辑窗口更新。请先保留当前文字，刷新后重新解锁编辑。');
    if (!response.ok) throw new Error('本机保存失败，请确认写作服务仍在运行。');
    etag = response.headers.get('ETag'); envelope = ciphertext; bundle = nextBundle; password = nextPassword;
  }
  async function initialize() {
    setBusy(true);
    try {
      if (!crypto.subtle) throw new Error('请使用 HTTPS 或本机地址访问。');
      if (editor) {
        const session = await fetch('/api/session'); if (!session.ok) throw new Error('本机写作服务不可用。'); token = (await session.json()).token;
      }
      const response = await fetch(endpoint, { cache: 'no-store' }); etag = response.headers.get('ETag') || 'empty';
      if (response.status === 404) {
        if (editor) {
          $('vault-description').textContent = '第一次使用：设置一个至少 12 个字符的独立长密码。';
          $('vault-confirm-wrap').hidden = false; $('vault-confirm').required = true;
          $('vault-password').minLength = 12; $('vault-password').autocomplete = 'new-password'; $('vault-submit').textContent = '创建加密手记本';
          status('标题和正文只在你的浏览器中加密，保存到项目的文件不会包含明文。');
        } else { $('vault-unlock').hidden = true; status('这里还没有可解锁的私人手记。'); }
      } else {
        if (!response.ok) throw new Error('加密手记暂时无法读取，请刷新重试。');
        envelope = MoonVault.validateEnvelope(await response.json()); status('手记已加密，等待解锁。');
      }
    } catch (error) { status(error.message); $('vault-unlock').hidden = true; }
    finally { setBusy(false); }
  }
  $('vault-unlock').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; setBusy(true); const input = $('vault-password').value;
    try {
      if (!envelope) {
        if (!editor || input !== $('vault-confirm').value) throw new Error('两次输入的密码不一致。');
        await persist({ version: 1, notes: [] }, input);
      } else { bundle = await MoonVault.decrypt(envelope, input); password = input; }
      $('vault-password').value = ''; $('vault-confirm').value = ''; $('vault-confirm-wrap').hidden = true; $('vault-confirm').required = false;
      $('vault-submit').textContent = '解锁手记'; $('vault-password').autocomplete = 'current-password';
      render(); status(editor ? '已解锁。编辑后点击加密保存。' : '已解锁。离开页面或闲置 5 分钟后会自动锁定。');
    } catch (error) { bundle = null; password = ''; status(error.name === 'OperationError' ? '密码不正确，或加密文件已损坏。' : error.message); }
    finally { setBusy(false); }
  });
  $('vault-lock').addEventListener('click', () => { if (dirty && !confirm('锁定会清除未保存的编辑，继续吗？')) return; lock(); });
  $('vault-new').addEventListener('click', () => editNote());
  $('vault-cancel').addEventListener('click', () => { if (dirty && !confirm('放弃尚未保存的编辑？')) return; clearEditor(); });
  $('vault-edit-form').addEventListener('input', () => { dirty = true; });
  $('vault-edit-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!editor || busy) return; setBusy(true);
    try {
      const note = { id: selected || crypto.randomUUID(), title: $('vault-title').value.trim(), date: $('vault-date').value, body: $('vault-body').value };
      if (!note.title) throw new Error('请输入标题。');
      const next = { version: 1, notes: [...bundle.notes.filter(n => n.id !== note.id), note] };
      await persist(next); selected = note.id; clearEditor(); render(); status('已加密保存。发布博客后，线上私人手记才会更新。');
    } catch (error) { status(error.message); } finally { setBusy(false); }
  });
  $('vault-delete').addEventListener('click', async () => {
    if (!editor || busy || !selected || !confirm('删除这篇私人手记？旧的加密文件会保留在本机备份目录。')) return;
    setBusy(true);
    try { await persist({ version: 1, notes: bundle.notes.filter(note => note.id !== selected) }); selected = null; clearEditor(); render(); status('已从当前手记本删除。发布后线上更新。'); }
    catch (error) { status(error.message); } finally { setBusy(false); }
  });
  $('vault-export').addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'moonlit-vault-encrypted.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('vault-rekey').addEventListener('submit', async event => {
    event.preventDefault(); if (!editor || busy) return;
    if (dirty) { status('请先保存或取消当前文章编辑，再修改密码。'); return; }
    if ($('vault-new-password').value !== $('vault-new-confirm').value) { status('两次新密码不一致。'); return; }
    setBusy(true);
    try { await persist(bundle, $('vault-new-password').value); $('vault-rekey').reset(); status('已使用新密码重新加密。请发布更新，并妥善保管旧备份的密码。'); }
    catch (error) { status(error.message); } finally { setBusy(false); }
  });
  ['pointerdown', 'keydown', 'scroll'].forEach(name => document.addEventListener(name, () => { activity = Date.now(); }, { passive: true }));
  setInterval(() => { if (bundle && !busy && !dirty && Date.now() - activity > 300000) lock(); }, 15000);
  addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  addEventListener('pagehide', () => { busy = false; lock(); });
  initialize();
})();
