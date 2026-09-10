'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { validateSource } = require('../lib/private-policy.cjs');
const root = path.resolve(__dirname, '..');
try { validateSource(path.join(root, 'source')); }
catch (error) { console.error(error.message); process.exit(1); }
const executable = path.join(path.dirname(require.resolve('hexo/package.json')), 'bin/hexo');
// Hexo can log a template or script error and still exit 0. Never deploy that output.
for (const command of ['clean', 'generate']) {
  const result = spawnSync(process.execPath, [executable, command], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if (result.error || result.status !== 0 || /\bERROR\b|\bFATAL\b/.test((result.stdout || '') + (result.stderr || ''))) process.exit(1);
}
