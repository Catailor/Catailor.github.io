const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { seriesPosts, readingStats } = require('../lib/notebook');
const { createJapaneseNote } = require('../tools/new-japanese.cjs');
const frontMatter = require('hexo-front-matter');

test('daily column includes its category newest first and preserves manually ordered topics', () => {
  const posts = [
    { file: 'first.md', date: '2026-09-10', categories: ['日语学习'] },
    { file: 'math.md', date: '2026-09-12', categories: ['ML'] },
    { file: 'second.md', date: '2026-09-11', categories: ['日语学习'] }
  ];
  assert.deepEqual(seriesPosts({ category: '日语学习', order: 'newest' }, posts).map(p => p.file), ['second.md','first.md']);
  assert.deepEqual(seriesPosts({ posts: ['first.md','second.md'] }, posts).map(p => p.file), ['first.md','second.md']);
  assert.deepEqual(seriesPosts({ category: '不存在' }, posts), []);
  assert.throws(() => seriesPosts({ category:'日语学习', posts:['first.md'] }, posts));
});

test('Japanese kana are counted as characters rather than one long English word', () => {
  assert.equal(readingStats('あいう アイウ 漢字').words, 8);
  assert.equal(readingStats('スーパー').words, 4);
  assert.equal(readingStats('あ'.repeat(701)).minutes, 3);
});

test('daily writing creates a normal categorized post and never replaces an existing diary', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-japanese-test-'));
  try {
    const first = createJapaneseNote('2026-09-10', dir);
    const post = frontMatter.parse(fs.readFileSync(first.file, 'utf8'));
    assert.equal(first.created, true);
    assert.equal(post.layout, 'post');
    assert.deepEqual(post.categories, ['日语学习']);
    assert.equal(post.title, '日语学习日记 · 2026-09-10');
    assert(post._content.includes('## 今日词语'));
    fs.writeFileSync(first.file, 'MY_EXISTING_DIARY');
    assert.equal(createJapaneseNote('2026-09-10', dir).created, false);
    assert.equal(fs.readFileSync(first.file, 'utf8'), 'MY_EXISTING_DIARY');
    assert.throws(() => createJapaneseNote('2026-02-30', dir));
    assert.throws(() => createJapaneseNote('../elsewhere', dir));
  } finally {
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'moonlit-japanese-test-')) throw new Error('Unexpected test path');
    fs.rmSync(dir, { recursive:true });
  }
});
