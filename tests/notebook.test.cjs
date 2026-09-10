const test = require('node:test');
const assert = require('node:assert/strict');
const { plainText, readingStats, safeUrl, withHeadingAnchors } = require('../lib/notebook');
const { load } = require('cheerio');
const vault = require('../source/js/vault-crypto');
const sample = { version: 1, notes: [{ id: 'test-note', title: 'PRIVATE_TITLE_SENTINEL', body: 'PRIVATE_BODY_SENTINEL 数学笔记', date: '2026-09-10' }] };
const password = 'test-only-long-passphrase-2026';

test('public build refuses private front matter and plaintext vault files', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { validateSource } = require('../lib/private-policy.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-policy-test-'));
  try {
    fs.writeFileSync(path.join(directory, 'note.md'), '---\nprivate: true\n---\nPRIVATE_SENTINEL');
    assert.throws(() => validateSource(directory));
    fs.writeFileSync(path.join(directory, 'note.md'), '---\nprivate: false\n---\nPublic');
    assert.doesNotThrow(() => validateSource(directory));
    fs.mkdirSync(path.join(directory, 'private'));
    fs.writeFileSync(path.join(directory, 'private/vault.json'), JSON.stringify(sample));
    assert.throws(() => validateSource(directory));
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'moonlit-policy-test-')) throw new Error('Unexpected test path');
    fs.rmSync(directory, { recursive: true });
  }
});

test('Chinese and English word counts and reading estimates', () => {
  assert.deepEqual(readingStats('你好世界 hello world'), { words: 6, minutes: 1 });
  assert.equal(readingStats('学'.repeat(701)).minutes, 3);
});

test('heading links remain stable and missing or duplicate headings get unique anchors', () => {
  const source = '<h2 id="旧链接">保留</h2><h1>同一标题</h1><h2>同一标题</h2><p><span class="katex">x²</span></p>';
  const result = withHeadingAnchors(source), $ = load(result);
  assert.deepEqual($('h1,h2').map((_, node) => $(node).attr('id')).get(), ['旧链接', '同一标题', '同一标题-2']);
  assert.equal($('.katex').text(), 'x²');
  assert.equal(withHeadingAnchors(result), result);
});
test('search text excludes duplicated math, scripts and reading metadata', () => {
  const text = plainText('<script>secret()</script><p>知识 <span class="katex-mathml">duplicate</span>x</p><div class="notebook-reading">999 字</div>');
  assert.equal(text, '知识 x');
  assert.equal(safeUrl('javascript:alert(1)'), null);
});
test('encrypted vault round trips without disclosing titles or bodies', async () => {
  const encrypted = await vault.encrypt(sample, password);
  assert(!JSON.stringify(encrypted).includes('SENTINEL'));
  assert(!JSON.stringify(encrypted).includes(password));
  assert.deepEqual(await vault.decrypt(encrypted, password), sample);
  const another = await vault.encrypt(sample, password);
  assert.notEqual(encrypted.salt, another.salt);
  assert.notEqual(encrypted.iv, another.iv);
  assert.notEqual(encrypted.ciphertext, another.ciphertext);
});
test('wrong passwords and ciphertext tampering fail authentication', async () => {
  const encrypted = await vault.encrypt(sample, password);
  await assert.rejects(vault.decrypt(encrypted, 'a-different-long-password'));
  const bytes = Buffer.from(encrypted.ciphertext, 'base64'); bytes[0] ^= 1;
  await assert.rejects(vault.decrypt({ ...encrypted, ciphertext: bytes.toString('base64') }, password));
});
test('vault rejects plaintext payloads, extra fields and unsafe parameters', async () => {
  assert.throws(() => vault.validateEnvelope(sample));
  const encrypted = await vault.encrypt(sample, password);
  assert.throws(() => vault.validateEnvelope({ ...encrypted, body: 'plaintext' }));
  assert.throws(() => vault.validateEnvelope({ ...encrypted, iterations: 1 }));
  assert.throws(() => vault.validateEnvelope({ ...encrypted, iv: 'AAAA' }));
  await assert.rejects(vault.encrypt(sample, 'short'));
});
