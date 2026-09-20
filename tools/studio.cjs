'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { safePath, revision, details, serialize, validatePublication, selectedAssets, md, updateTaxonomy } = require('./studio-content.cjs');
const { createJapaneseNote } = require('./new-japanese.cjs');
const { library, saveLibrary, posts, resolveId, basename } = require('./studio-library.cjs');
const { publish } = require('./studio-publish.cjs');
const {listTrash,trash,restore,discardEmpty} = require('./studio-trash.cjs');
const { createPrivateServer } = require('./private-editor.cjs');
const history = require('./studio-history.cjs');
const ROOT = path.resolve(__dirname, '..');
function createStudio({ root = ROOT, privatePort = 4002, publisher = publish } = {}) {
  const editorFile = require('./studio-assets.cjs').editorBundle();
  const token = crypto.randomBytes(32).toString('hex');
  const stateDir = path.join(root, '.studio'); fs.mkdirSync(stateDir, { recursive: true });
  const jobFile = path.join(stateDir, 'publication.json'); let publishing = false, checking = false, interrupted = false, job = { state: 'idle', message: '选择一篇草稿开始。' };
  try { job = JSON.parse(fs.readFileSync(jobFile)); if (['building', 'uploading'].includes(job.state)) {interrupted=true;job = { ...job,state: 'error', message: '上次发布被中断，请检查线上状态后重试。' };} } catch (_) {}
  const publicationFile=path.join(stateDir,'publications.json');
  const publicationLog=()=>{try{return JSON.parse(fs.readFileSync(publicationFile,'utf8'));}catch(_){return [];}};
  const report = value => {
    job = { ...job, ...value, updated: new Date().toISOString() }; fs.writeFileSync(jobFile, JSON.stringify(job));
    const log=publicationLog(),key=job.publicationId||job.release||job.commit;
    if(key){const index=log.findIndex(item=>item.key===key),entry={...job,key};if(index>=0)log[index]=entry;else log.unshift(entry);fs.writeFileSync(publicationFile,JSON.stringify(log.slice(0,50)));}
  };
  if(interrupted)report({});
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
    res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src 'self' http://127.0.0.1:${privatePort}; object-src 'none'; base-uri 'none'; form-action 'none'`);
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin)) return send(403, { error: '访问来源不正确' });
    const url = new URL(req.url, origin);
    try {
      if (req.method === 'GET') {
        if (url.pathname === '/api/session') return send(200, { token, version:'history-v1', privateUrl: `http://127.0.0.1:${privatePort}/` });
        if (url.pathname === '/api/history') {
          const id=resolveId(root,url.searchParams.get('id'));details(root,id);
          history.importLegacy(root);
          return send(200,history.entries(root,id));
        }
        if (url.pathname === '/api/history-version') {
          const id=resolveId(root,url.searchParams.get('id'));details(root,id);
          const {raw,...version}=history.read(root,id,url.searchParams.get('key'));return send(200,version);
        }
        if (url.pathname === '/taxonomy.js') return send(200,fs.readFileSync(path.join(ROOT,'lib/studio-taxonomy.js')),'text/javascript');
        if (url.pathname === '/api/status') { await checkDeployment(); return send(200, job); }
        if (url.pathname === '/api/publications') {await checkDeployment();return send(200,publicationLog().map(record=>({...record,items:record.items?.map(item=>({...item,url:item.action==='withdraw'?null:require('./studio-content.cjs').publishedUrl(root,item.id)}))})));}
        if (url.pathname === '/api/posts') {
          return send(200, posts(root).map(post => {
            const selected = job.items?.find(item => basename(item.id) === basename(post.id));
            if (selected && ['building','uploading','deploying'].includes(job.state) && post.revision === selected.revision) post.status = 'pending';
            return post;
          }));
        }
        if (url.pathname === '/api/library') return send(200, library(root));
        if (url.pathname === '/api/trash') return send(200,listTrash(root));
        if (url.pathname === '/api/post') return send(200, details(root, resolveId(root, url.searchParams.get('id'))));
        if (url.pathname === '/preview.css') return send(200,
          ['moonlit.css','notebook.css','letter.css','article-content.css'].map(file=>fs.readFileSync(path.join(ROOT,'source/css',file),'utf8')).join('\n') +
          '\nbody{margin:0;background:var(--moon-panel);color:var(--moon-text)}main{max-width:776px;margin:32px auto;padding:0 32px 60px}header h1{font:600 30px/1.65 var(--letter-serif)}table{border-collapse:collapse}td,th{border:1px solid var(--moon-line)}pre{padding:16px;background:var(--moon-paper);border-radius:10px}a{color:var(--moon-ink)}', 'text/css');
        const assets = { '/': ['tools/studio/index.html', 'text/html'], '/studio.js': ['tools/studio/studio.js', 'text/javascript'], '/studio.css': ['tools/studio/studio.css', 'text/css'] };
        if(url.pathname==='/article-content.css')return send(200,fs.readFileSync(path.join(ROOT,'source/css/article-content.css')),'text/css');
        if (assets[url.pathname]) { const [file, type] = assets[url.pathname]; return send(200, fs.readFileSync(path.join(ROOT, file)), type); }
        if (url.pathname === '/purify.js') return send(200,fs.readFileSync(path.join(path.dirname(require.resolve('dompurify')),'purify.min.js')),'text/javascript');
        if (url.pathname === '/editor.js') return send(200,fs.readFileSync(editorFile),'text/javascript');
        const editorAssets = {'/editor.css':'toastui-editor.css'};
        if (editorAssets[url.pathname]) return send(200, fs.readFileSync(path.join(path.dirname(require.resolve('@toast-ui/editor')), editorAssets[url.pathname])), url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript');
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
      if (['/api/trash','/api/restore','/api/discard-empty'].includes(url.pathname)) {
        if(publishing || job.state==='deploying')throw new Error('发布完成后可以删除或恢复文章，期间仍可继续写作');
        if(url.pathname==='/api/trash')return send(200,trash(root,input.items));
        if(url.pathname==='/api/restore')return send(200,restore(root,input.key));
        return send(200,discardEmpty(root,input));
      }
      if (url.pathname === '/api/library') return send(200, saveLibrary(root,input));
      if (url.pathname === '/api/taxonomy') return send(200,require('./studio-taxonomy.cjs').applyBatch(root,input));
      if (url.pathname === '/api/taxonomy-undo') return send(200,require('./studio-taxonomy.cjs').undoBatch(root,input.key));
      if (url.pathname === '/api/new') {
        input.mode ||= 'post';
        if (!['quick', 'full', 'post'].includes(input.mode)) throw new Error('请选择文章模板');
        const collection = library(root), series = input.series ? collection.series.find(s => s.id === input.series) : null;
        const template = input.template ? collection.templates.find(t => t.id === input.template) : null;
        if ((input.series && !series) || (input.template && !template)) throw new Error('系列或模板已变更，请刷新后重试');
        if(input.mode==='post'&&!template) {
          const empty=posts(root).find(p=>{
            if(!p.id.startsWith('source/_drafts/'))return false;
            const data=require('./studio-content.cjs').parseDocument(fs.readFileSync(safePath(root,p.id),'utf8'));
            const members=collection.series.filter(s=>s.posts.includes(basename(p.id)));
            return data.studio_empty&&!String(data.title||'').trim()&&!data._content.trim()&&!String(data.description||'').trim()&&(series?members.length===1&&members[0].id===series.id:!members.length)&&JSON.stringify(p.categories)===JSON.stringify(series?.defaults?.categories||[])&&JSON.stringify(p.tags)===JSON.stringify(series?.defaults?.tags||[]);
          });
          if(empty)return send(200,details(root,empty.id));
        }
        const directory = path.join(root, 'source/_drafts'); let id;
        if (input.mode !== 'post') {
          const published = 'source/_posts/japanese-' + input.date + '.md';
          if (fs.existsSync(safePath(root, published))) return send(200, details(root, published));
          const result = createJapaneseNote(input.date, directory, input.mode); id = 'source/_drafts/' + path.basename(result.file);
        } else {
          id = 'source/_drafts/note-' + crypto.randomUUID() + '.md'; fs.mkdirSync(directory, { recursive: true });
          const day = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : new Date().toLocaleDateString('sv-SE');
          fs.writeFileSync(safePath(root, id), `---\nlayout: post\nstudio_empty: true\ntitle: ''\ndate: ${day} 12:00:00\n---\n\n`, { flag: 'wx' });
        }
        if (template) {
          const doc = details(root,id); fs.writeFileSync(safePath(root,id),serialize(fs.readFileSync(safePath(root,id),'utf8'),{...doc,body:template.body}));
        }
        if (url.pathname.startsWith('/img/')) {
          const base=path.resolve(root,'source/img'),file=path.resolve(root,'source','.'+decodeURIComponent(url.pathname));
          const type={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml'}[path.extname(file).toLowerCase()];
          if(!type||!fs.existsSync(file)||!fs.realpathSync(file).startsWith(base+path.sep))return send(404,{});
          return send(200,fs.readFileSync(file),type);
        }
        if(series?.defaults&&input.mode==='post'){
          const file=safePath(root,id),raw=fs.readFileSync(file,'utf8');fs.writeFileSync(file,updateTaxonomy(raw,series.defaults));
        }
        if (series && !series.posts.includes(basename(id))) { series.posts.push(basename(id)); saveLibrary(root,collection); }
        return send(200, details(root, id));
      }
      if (url.pathname === '/api/save') {
        input.id = resolveId(root,input.id);
        const file = safePath(root, input.id); if (!/\.md$/.test(file)) throw new Error('请选择公开文章');
        const old = fs.readFileSync(file, 'utf8'); if (revision(old) !== input.revision) return send(409, { error: '另一个窗口修改了文章。请先复制当前内容，再重新打开文章。' });
        const next = serialize(old, input);
        if(next===old)return send(200,details(root,input.id));
        history.snapshot(root,input.id,old);
        fs.writeFileSync(file + '.tmp', next); fs.renameSync(file + '.tmp', file);
        return send(200, details(root, input.id));
      }
      if (url.pathname === '/api/preview') {
        return send(200, { html: require('../lib/article-renderer.cjs').renderArticle(String(input.body || '').slice(0, 200000)) });
      }
      if (url.pathname === '/api/history-restore') return send(200,history.restoreVersion(root,input));
      if (url.pathname === '/api/upload') {
        if (typeof input.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw new Error('图片数据不正确');
        const bytes = Buffer.from(input.data, 'base64'); if (bytes.length > 5000000) throw new Error('图片请小于 5 MB');
        const extension = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'jpg' : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6)) ? 'gif' : '';
        if (!extension) throw new Error('请使用 PNG、JPG、WebP 或 GIF 图片');
        const id = `source/img/uploads/${crypto.randomUUID()}.${extension}`, file = safePath(root, id); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx' });
        return send(200, { url: id.replace('source', '') });
      }
      if (url.pathname === '/api/review') {
        const reviewLibrary=library(root);
        if (input.seriesOnly) return send(200,{seriesOnly:true,libraryRevision:reviewLibrary.revision,title:'系列目录',summary:'更新系列名称、简介和顺序；草稿正文不会上传。',changes:await require('./studio-publish.cjs').seriesChanges(root,reviewLibrary),assets:[]});
        const id = input.private ? 'source/private/vault.json' : resolveId(root,input.id), bytes = fs.readFileSync(safePath(root, id));
        if (input.private) { require('../source/js/vault-crypto').validateEnvelope(JSON.parse(bytes)); return send(200, { id, revision: revision(bytes), title: '加密私人手记本', summary: '只上传当前密文，密码与正文不会发送到写作台。', category: '私人手记', assets: [] }); }
        if(input.withdraw&&!posts(root).find(p=>p.id===id)?.isPublished)throw new Error('这篇文章尚未发布，无需撤回');
        const changes=await require('./studio-publish.cjs').seriesChanges(root,reviewLibrary,[{id,bytes,action:input.withdraw?'withdraw':'publish'}]);
        if(input.withdraw)return send(200,{id,revision:revision(bytes),libraryRevision:reviewLibrary.revision,action:'withdraw',title:details(root,id).title,summary:'网站更新后，这篇文章会下线；最新正文保留为本机草稿，可以再次发布。',assets:[],changes});
        return send(200, { id, revision: revision(bytes), libraryRevision:reviewLibrary.revision,changes, warnings:require('./studio-content.cjs').imageWarnings(root,require('./studio-content.cjs').parseDocument(bytes.toString('utf8'))._content||''), ...validatePublication(bytes.toString('utf8')), assets: selectedAssets(root, bytes.toString('utf8')) });
      }
      if (url.pathname === '/api/publish') {
        if (publishing || job.state === 'deploying') return send(409,{error:'上一批内容仍在发布，可以继续写，等它上线后再发下一批。'});
        if (!Array.isArray(input.items) || (input.seriesOnly ? input.items.length !== 0 : input.items.length !== 1)) throw new Error('请先预览本次发布内容');
        const snapshot = library(root);
        if (input.libraryRevision && input.libraryRevision !== snapshot.revision) return send(409,{error:'系列已改变，请重新预览后发布'});
        input.items = input.items.map(item => ({...item,id:resolveId(root,item.id)}));
        if(input.items.some(item=>item.action && !['publish','withdraw'].includes(item.action)))throw new Error('发布操作不正确');
        publishing = true; job = {}; report({ publicationId:crypto.randomUUID(),state: 'building', message: '正在发布快照，可以继续写作。', items:input.items });
        publisher(root, input.items, report, input.items[0]?.id === 'source/private/vault.json' ? null : snapshot).catch(error => report({ state: 'error', message: error.message })).finally(() => { publishing = false; });
        return send(202, job);
      }
      send(404, { error: '操作不存在' });
    } catch (error) { send(error.status || 400, { error: error.message }); }
  });
  return server;
}
module.exports = { createStudio };
if (require.main === module) {
  const port = Number(process.env.MOONLIT_STUDIO_PORT || 4003), privatePort = Number(process.env.MOONLIT_PRIVATE_PORT || 4006);
  const privateServer = createPrivateServer({studioOrigin:`http://127.0.0.1:${port}`}); privateServer.on('error', e => { if (e.code !== 'EADDRINUSE') console.error(e.message); }); privateServer.listen(privatePort, '127.0.0.1');
  const studio = createStudio({ privatePort }); studio.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `写作台已在运行：http://127.0.0.1:${port}/` : e.message); privateServer.close(); });
  studio.listen(port, '127.0.0.1', () => console.log(`写作台：http://127.0.0.1:${port}/\n关闭此进程可停止本机写作服务。`));
}
