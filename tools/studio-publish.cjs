'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { safePath, validatePublication, selectedAssets, revision } = require('./studio-content.cjs');
const { validateEnvelope } = require('../source/js/vault-crypto');
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, shell: false }); let output = '';
    const timer = setTimeout(() => child.kill(), 240000);
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-40000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-40000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output.trim()) : reject(new Error(output || '操作失败或超时')); });
  });
}
async function publish(root, selection, report) {
  if (!selection.length || selection.length > 20) throw new Error('请选择 1–20 个发布项目');
  const selected = selection.map(item => {
    const file = safePath(root, item.id), bytes = fs.readFileSync(file);
    if (revision(bytes) !== item.revision) throw new Error('内容已改变，请刷新发布预览');
    if (item.id === 'source/private/vault.json') validateEnvelope(JSON.parse(bytes)); else validatePublication(bytes.toString('utf8'));
    return { id: item.id, dest: item.id.replace('source/_drafts/', 'source/_posts/'), bytes };
  });
  for (const item of selected) if (item.id !== item.dest && fs.existsSync(safePath(root, item.dest))) throw new Error('已有同名文章，请在文章列表编辑它');
  const payload = new Map(selected.map(item => [item.dest, item.bytes]));
  for (const item of selected) if (item.id !== 'source/private/vault.json') for (const asset of selectedAssets(root, item.bytes.toString('utf8'))) payload.set(asset, fs.readFileSync(safePath(root, asset)));
  const originals = new Map([...payload.keys(), 'source/studio-release.json'].map(id => {
    const file = path.join(root, id); return [id, fs.existsSync(file) ? fs.readFileSync(file) : null];
  }));
  if (await run('git', ['branch', '--show-current'], root) !== 'main') throw new Error('请在 main 分支使用发布入口');
  if (await run('git', ['diff', '--cached', '--name-only'], root)) throw new Error('项目还有暂存的其他改动，请先完成该次操作再发布');
  const base = await run('git', ['rev-parse', 'HEAD'], root);
  const remote = (await run('git', ['ls-remote', 'origin', 'refs/heads/main'], root)).split(/\s/)[0];
  if (base !== remote) throw new Error('本机和线上版本不同，请先同步项目，再发布所选文章');
  const work = path.join(root, '.studio', 'work-' + crypto.randomUUID()), release = crypto.randomUUID();
  let created = false, pushed = false;
  try {
    report({ state: 'building', message: '正在检查所选内容并生成网站…' });
    fs.mkdirSync(path.dirname(work), { recursive: true });
    await run('git', ['worktree', 'add', '--detach', work, base], root); created = true;
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(work, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const files = new Set();
    for (const [id, bytes] of payload) {
      const destination = safePath(work, id); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, bytes); files.add(id);
    }
    fs.writeFileSync(path.join(work, 'source/studio-release.json'), JSON.stringify({ release })); files.add('source/studio-release.json');
    await run(process.execPath, [path.join(work, 'tools/build.cjs')], work);
    await run('git', ['add', '--', ...files], work);
    await run('git', ['commit', '-m', 'Publish selected notebook entries'], work);
    const commit = await run('git', ['rev-parse', 'HEAD'], work);
    // Recheck before the irreversible push; never force push or sweep unrelated files.
    if (await run('git', ['rev-parse', 'HEAD'], root) !== base || await run('git', ['diff', '--cached', '--name-only'], root)) throw new Error('项目在发布期间发生变化，请重新预览后发布');
    for (const item of selected) if (!fs.readFileSync(safePath(root, item.id)).equals(item.bytes)) throw new Error('文章在发布期间被修改，请重新预览后发布');
    for (const [id, original] of originals) {
      const file = path.join(root, id), current = fs.existsSync(file) ? fs.readFileSync(file) : null;
      if (original ? !current?.equals(original) : current !== null) throw new Error('文件在发布期间被修改，请重新预览后发布');
    }
    report({ state: 'uploading', message: '检查通过，正在上传所选内容…' });
    await run('git', ['push', 'origin', 'HEAD:main'], work); pushed = true;
    // Keep all unrelated working files intact while advancing the local branch/index.
    await run('git', ['update-ref', 'HEAD', commit, base], root);
    for (const file of files) {
      const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), { recursive: true });
      const original = originals.get(file), current = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
      if (original ? current?.equals(original) : current === null) fs.copyFileSync(path.join(work, file), destination);
    }
    await run('git', ['reset', 'HEAD', '--', ...files], root);
    for (const item of selected) if (item.id !== item.dest) {
      const draft = safePath(root, item.id);
      if (fs.existsSync(draft) && fs.readFileSync(draft).equals(item.bytes)) fs.unlinkSync(draft);
    }
    report({ state: 'deploying', message: '已上传，等待网站更新…', commit, release });
  } catch (error) {
    if (pushed) throw new Error('内容已上传，但本机同步未完成。请先同步项目，避免重复发布。' + error.message);
    throw error;
  } finally {
    if (created) {
      const absolute = path.resolve(work);
      if (path.dirname(absolute) !== path.resolve(root, '.studio') || !path.basename(absolute).startsWith('work-')) throw new Error('临时工作区路径不正确');
      const modules = path.join(absolute, 'node_modules');
      if (fs.existsSync(modules) && fs.lstatSync(modules).isSymbolicLink()) fs.unlinkSync(modules);
      await run('git', ['worktree', 'remove', '--force', absolute], root).catch(() => {});
    }
  }
}
module.exports = { publish, run };
