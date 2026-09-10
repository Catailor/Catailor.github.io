'use strict';
const fs = require('node:fs');
const path = require('node:path');
const frontMatter = require('hexo-front-matter');
const { validateEnvelope } = require('../source/js/vault-crypto');
function validateSource(source) {
  const visit = directory => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) visit(file);
      else if (/\.(md|markdown|html)$/i.test(item.name)) {
        const data = frontMatter.parse(fs.readFileSync(file, 'utf8'));
        if (data.private || data.password) throw new Error('发现放在公开 source 中的私人文章。请移到仓库外，并使用 npm run private 加密保存。');
      }
    }
  };
  visit(source);
  const directory = path.join(source, 'private');
  if (!fs.existsSync(directory)) return;
  for (const name of fs.readdirSync(directory)) if (!['index.html', 'vault.json'].includes(name)) throw new Error('source/private 不允许明文文章或私人附件。');
  const vault = path.join(directory, 'vault.json');
  if (fs.existsSync(vault)) validateEnvelope(JSON.parse(fs.readFileSync(vault, 'utf8')));
}
module.exports = { validateSource };
