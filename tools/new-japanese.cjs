'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function createJapaneseNote(day, directory = path.join(root, 'source/_posts')) {
  const parsed = new Date(day + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number(day.slice(0, 4)) < 1970 || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== day) throw new Error('日期请填写真实的 YYYY-MM-DD，例如 2026-09-11。');
  const file = path.join(directory, `japanese-${day}.md`);
  const content = fs.readFileSync(path.join(root, 'scaffolds/japanese.md'), 'utf8')
    .replace('{{ title }}', `日语学习日记 · ${day}`)
    .replace('{{ date }}', `${day} 12:00:00`);
  fs.mkdirSync(directory, { recursive: true });
  try { fs.writeFileSync(file, content, { flag: 'wx' }); }
  catch (error) { if (error.code === 'EEXIST') return { file, created: false }; throw error; }
  return { file, created: true };
}

module.exports = { createJapaneseNote };
if (require.main === module) {
  try {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (process.argv.length > 3) throw new Error('只需指定一个日期，例如 npm run japanese -- 2026-09-11。');
    const result = createJapaneseNote(process.argv[2] || today);
    console.log(`${result.created ? '已新建日语学习日记' : '这天的日记已存在，请继续编辑原文件'}：\n${result.file}\n填好内容后再发布，文章会自动进入日语专栏。`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
