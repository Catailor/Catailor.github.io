'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { safePath, revision, details, serialize, validatePublication, selectedAssets, md } = require('./studio-content.cjs');
const { createJapaneseNote } = require('./new-japanese.cjs');
const { publish } = require('./studio-publish.cjs');
const { createPrivateServer } = require('./private-editor.cjs');
const ROOT = path.resolve(__dirname, '..');
function createStudio({ root = ROOT, privatePort = 4002, publisher = publish } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const stateDir = path.join(root, '.studio'); fs.mkdirSync(stateDir, { recursive: true });
  const jobFile = path.join(stateDir, 'publication.json'); let publishing = false, checking = false, job = { state: 'idle', message: '选择一篇草稿开始。' };
  try { job = JSON.parse(fs.readFileSync(jobFile)); if (['building', 'uploading'].includes(job.state)) job = { state: 'error', message: '上次发布被中断，请检查线上状态后重试。' }; } catch (_) {}
  const report = value => { job = { ...job, ...value, updated: new Date().toISOString() }; fs.writeFileSync(jobFile, JSON.stringify(job)); };
  async function checkDeployment() {
    if (job.state !== 'deploying' || checking || !job.release) return;
    checking = true;
    try {
      const response = await fetch(`https://catailor.github.io/studio-release.json?check=${Date.now()}`, { signal: AbortSignal.timeout(6000), cache: 'no-store' });
      if (response.ok && (await response.json()).release === job.release) report({ state: 'live', message: '已上线，网站已显示本次发布的内容。' });
      else if (Date.now() - new Date(job.updated).getTime() > 600000) job.message = '已上传，但尚未确认上线；可以查看网站或部署记录，稍后会继续检查。';
    } catch (_) {} finally { checking = false; }
  }
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: '访问来源不正确' });
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/api/session') return send(200, { token, privateUrl: `http://127.0.0.1:${privatePort}/` });
        if (url.pathname === '/api/status') { await checkDeployment(); return send(200, job); }
        if (url.pathname === '/api/posts') {
          const items = [];
          for (const directory of ['source/_drafts', 'source/_posts']) if (fs.existsSync(path.join(root, directory))) for (const entry of fs.readdirSync(path.join(root, directory))) {
            if (!entry.endsWith('.md')) continue;
            try { const item = details(root, directory + '/' + entry); delete item.body; items.push(item); } catch (_) {}
          }
          return send(200, items.sort((a, b) => Number(b.draft) - Number(a.draft) || b.date.localeCompare(a.date)));
        }
        if (url.pathname === '/api/post') return send(200, details(root, url.searchParams.get('id')));
        const assets = { '/': ['tools/studio/index.html', 'text/html'], '/studio.js': ['tools/studio/studio.js', 'text/javascript'], '/studio.css': ['tools/studio/studio.css', 'text/css'] };
        if (assets[url.pathname]) { const [file, type] = assets[url.pathname]; return send(200, fs.readFileSync(path.join(ROOT, file)), type); }
        if (/^\/img\/uploads\/[\w.-]+$/.test(url.pathname)) {
          const file = safePath(root, 'source' + url.pathname), type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(file)];
          if (!type) return send(404, {}); return send(200, fs.readFileSync(file), type);
        }
        if (url.pathname.startsWith('/katex/')) {
          const rel = url.pathname.slice(7); if (!/^(katex\.min\.css|fonts\/[\w.-]+\.woff2?)$/.test(rel)) return send(404, {});
          return send(200, fs.readFileSync(path.join(path.dirname(require.resolve('katex/package.json')), 'dist', rel)), rel.endsWith('.css') ? 'text/css' : 'font/woff2');
        }
        return send(404, { error: '页面不存在' });
      }
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-studio-token'] !== token || !req.headers['content-type']?.startsWith('application/json')) return send(403, { error: '请从本机写作台操作' });
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 9000000) return send(413, { error: '内容过大，请将图片控制在 5 MB 以内' }); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks));
      if (publishing && url.pathname !== '/api/preview') return send(409, { error: '正在发布，请稍后再编辑' });
      if (url.pathname === '/api/new') {
        if (!['quick', 'full', 'post'].includes(input.mode)) throw new Error('请选择文章模板');
        const directory = path.join(root, 'source/_drafts'); let id;
        if (input.mode !== 'post') {
          const published = 'source/_posts/japanese-' + input.date + '.md';
          if (fs.existsSync(safePath(root, published))) return send(200, details(root, published));
          const result = createJapaneseNote(input.date, directory, input.mode); id = 'source/_drafts/' + path.basename(result.file);
        } else {
          id = 'source/_drafts/note-' + crypto.randomUUID() + '.md'; fs.mkdirSync(directory, { recursive: true });
          const day = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toLocaleDateString('sv-SE');
          fs.writeFileSync(safePath(root, id), `---\nlayout: post\ntitle: ''\ndate: ${day} 12:00:00\n---\n\n`, { flag: 'wx' });
        }
        return send(200, details(root, id));
      }
      if (url.pathname === '/api/save') {
        const file = safePath(root, input.id); if (!/\.md$/.test(file)) throw new Error('请选择公开文章');
        const old = fs.readFileSync(file, 'utf8'); if (revision(old) !== input.revision) return send(409, { error: '另一个窗口修改了文章。请先复制当前内容，再重新打开文章。' });
        const next = serialize(old, input), backup = path.join(root, '.studio-backups'); fs.mkdirSync(backup, { recursive: true });
        fs.writeFileSync(path.join(backup, Date.now() + '-' + crypto.randomUUID() + '.md'), old);
        fs.writeFileSync(file + '.tmp', next); fs.renameSync(file + '.tmp', file);
        return send(200, details(root, input.id));
      }
      if (url.pathname === '/api/preview') {
        return send(200, { html: md.render(String(input.body || '').slice(0, 200000)) });
      }
      if (url.pathname === '/api/upload') {
        if (typeof input.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new Error('图片数据不正确');
        const bytes = Buffer.from(input.data, 'base64'); if (bytes.length > 5000000) throw new Error('图片请小于 5 MB');
        const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) ? 'gif' : '';
        if (!extension) throw new Error('请使用 PNG、JPG、WebP 或 GIF 图片');
        const id = `source/img/uploads/${crypto.randomUUID()}.${extension}`, file = safePath(root, id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
        return send(200, { url: id.replace('source', '') });
      }
      if (url.pathname === '/api/review') {
        const id = input.private ? 'source/private/vault.json' : input.id, bytes = fs.readFileSync(safePath(root, id));
        if (input.private) { require('../source/js/vault-crypto').validateEnvelope(JSON.parse(bytes)); return send(200, { id, revision: revision(bytes), title: '加密私人手记本', summary: '只上传当前密文，密码与正文不会发送到写作台。', category: '私人手记', assets: [] }); }
        return send(200, { id, revision: revision(bytes), ...validatePublication(bytes.toString('utf8')), assets: selectedAssets(root, bytes.toString('utf8')) });
      }
      if (url.pathname === '/api/publish') {
        if (!Array.isArray(input.items) || input.items.length !== 1) throw new Error('请先预览本次发布内容');
        publishing = true; job = {}; report({ state: 'building', message: '准备发布所选内容…' });
        publisher(root, input.items, report).catch(error => report({ state: 'error', message: error.message })).finally(() => { publishing = false; });
        return send(202, job);
      }
      send(404, { error: '操作不存在' });
    } catch (error) { send(400, { error: error.message }); }
  });
  return server;
}
module.exports = { createStudio };
if (require.main === module) {
  const port = Number(process.env.MOONLIT_STUDIO_PORT || 4003), privatePort = Number(process.env.MOONLIT_PRIVATE_PORT || 4006);
  const privateServer = createPrivateServer(); privateServer.on('error', e => { if (e.code !== 'EADDRINUSE') console.error(e.message); }); privateServer.listen(privatePort, '127.0.0.1');
  const studio = createStudio({ privatePort }); studio.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `写作台已在运行：http://127.0.0.1:${port}/` : e.message); privateServer.close(); });
  studio.listen(port, '127.0.0.1', () => console.log(`写作台：http://127.0.0.1:${port}/\n关闭此进程可停止本机写作服务。`));
}
