'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateEnvelope } = require('../source/js/vault-crypto');
const root = path.resolve(__dirname, '..');
function createPrivateServer({ vaultPath = path.join(root, 'source/private/vault.json'), backupsPath = path.join(root, '.private-backups'), port = 4002, studioOrigin = null } = {}) {
if (studioOrigin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(studioOrigin)) throw new Error('Invalid studio origin');
const token = crypto.randomBytes(32).toString('hex');
const current = () => fs.existsSync(vaultPath) ? fs.readFileSync(vaultPath) : null;
const tag = data => data ? `"${crypto.createHash('sha256').update(data).digest('hex')}"` : 'empty';
const assets = {
  '/css/vault.css': ['source/css/vault.css', 'text/css'],
  '/js/vault.js': ['source/js/vault.js', 'text/javascript'],
  '/js/vault-crypto.js': ['source/js/vault-crypto.js', 'text/javascript'],
  '/js/vendor/markdown-it.min.js': [path.relative(root, require.resolve('markdown-it/browser')), 'text/javascript']
};
const server = http.createServer((req, res) => {
  const host = `127.0.0.1:${server.address().port}`, origin = `http://${host}`;
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (studioOrigin) res.setHeader('Content-Security-Policy', `frame-ancestors ${studioOrigin}`);
  else res.setHeader('X-Frame-Options', 'DENY');
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8` }); res.end(body); };
  if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin)) return send(403, '{"error":"Forbidden"}');
  const pathname = new URL(req.url, origin).pathname;
  if (req.method === 'GET') {
    if (pathname === '/api/session') return send(200, JSON.stringify({ token }));
    if (pathname === '/api/vault') { const bytes = current(); res.setHeader('ETag', tag(bytes)); return send(bytes ? 200 : 404, bytes || '{"empty":true}'); }
    if (pathname === '/api/backups') {
      const names = fs.existsSync(backupsPath) ? fs.readdirSync(backupsPath).filter(n => /^\d+-[a-f0-9-]+\.json$/.test(n)).sort().reverse().slice(0, 60) : [];
      return send(200, JSON.stringify(names.map(id => ({ id, date: new Date(Number(id.split('-')[0])).toISOString() }))));
    }
    if (pathname === '/api/backup') {
      const id = new URL(req.url, origin).searchParams.get('id');
      if (!/^\d+-[a-f0-9-]+\.json$/.test(id || '')) return send(400, '{"error":"Invalid backup"}');
      try { const bytes = fs.readFileSync(path.join(backupsPath, id)); validateEnvelope(JSON.parse(bytes)); return send(200, bytes); }
      catch (_) { return send(404, '{"error":"Backup not found"}'); }
    }
    if (pathname === '/') {
      const html = fs.readFileSync(path.join(root, 'source/private/index.html'), 'utf8').replace(/^---[\s\S]*?---\s*/, '').replace('<body>', '<body data-editor="true">');
      return send(200, html, 'text/html');
    }
    if (assets[pathname]) { const [file, type] = assets[pathname]; return send(200, fs.readFileSync(path.join(root, file)), type); }
    return send(404, '{"error":"Not found"}');
  }
  if (req.method !== 'PUT' || pathname !== '/api/vault') return send(405, '{"error":"Method not allowed"}');
  if (req.headers.origin !== origin || req.headers['x-vault-token'] !== token || !req.headers['content-type']?.startsWith('application/json')) return send(403, '{"error":"Forbidden"}');
  let bytes = 0, body = [], tooLarge = false;
  req.on('data', chunk => { bytes += chunk.length; if (bytes > 12001000) { if (!tooLarge) send(413, '{"error":"Too large"}'); tooLarge = true; body = []; } else if (!tooLarge) body.push(chunk); });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      const envelope = validateEnvelope(JSON.parse(Buffer.concat(body).toString('utf8')));
      const previous = current(); if (req.headers['if-match'] !== tag(previous)) return send(409, '{"error":"Conflict"}');
      if (previous) {
        fs.mkdirSync(backupsPath, { recursive: true });
        fs.writeFileSync(path.join(backupsPath, `${Date.now()}-${crypto.randomUUID()}.json`), previous, { flag: 'wx', mode: 0o600 });
      }
      const next = Buffer.from(JSON.stringify(envelope));
      const temporary = vaultPath + '.tmp'; fs.writeFileSync(temporary, next, { mode: 0o600 }); fs.renameSync(temporary, vaultPath);
      res.setHeader('ETag', tag(next)); send(200, '{"saved":true}');
    } catch (_) { send(400, '{"error":"Invalid encrypted vault"}'); }
  });
});
return server;
}
module.exports = { createPrivateServer };
if (require.main === module) {
const port = Number(process.env.MOONLIT_PRIVATE_PORT || 4002);
const server = createPrivateServer({ port });
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? '本机写作入口已在运行，请打开 http://127.0.0.1:4002/' : '无法启动本机写作入口：' + error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`私人手记写作入口：http://127.0.0.1:${port}\n仅接受本机访问，只保存加密文件。关闭窗口或按 Ctrl+C 停止。`));
}
