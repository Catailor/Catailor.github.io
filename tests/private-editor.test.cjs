const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { once } = require('node:events');
const { createPrivateServer } = require('../tools/private-editor.cjs');
const { encrypt, decrypt } = require('../source/js/vault-crypto');

test('local writer rejects cross-origin, plaintext and stale writes; only ciphertext reaches disk', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moonlit-editor-test-'));
  const file = path.join(directory, 'vault.json'), backups = path.join(directory, 'backups');
  const server = createPrivateServer({ vaultPath: file, backupsPath: backups, port: 0 });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/api/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(base + '/api/vault')).status, 404);
    const { token } = await (await fetch(base + '/api/session')).json();
    const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Vault-Token': token, 'If-Match': 'empty' };
    const bundle = { version: 1, notes: [{ id:'1', title:'CONFIDENTIAL_TEST_TITLE', body:'CONFIDENTIAL_TEST_BODY', date:'2026-09-10' }] };
    const password = 'temporary-test-only-passphrase';
    const cipher = await encrypt(bundle, password);
    assert.equal((await fetch(base + '/api/vault', { method:'PUT', headers:{ ...headers, 'X-Vault-Token':'wrong' }, body:JSON.stringify(cipher) })).status, 403);
    assert.equal((await fetch(base + '/api/vault', { method:'PUT', headers, body:JSON.stringify(bundle) })).status, 400);
    assert.equal(fs.existsSync(file), false);
    const saved = await fetch(base + '/api/vault', { method:'PUT', headers, body:JSON.stringify(cipher) });
    assert.equal(saved.status, 200);
    assert(!fs.readFileSync(file,'utf8').includes('CONFIDENTIAL'));
    assert.equal((await fetch(base + '/api/vault', { method:'PUT', headers, body:JSON.stringify(cipher) })).status, 409);
    const read = await fetch(base + '/api/vault');
    assert.deepEqual(await decrypt(await read.json(), password), bundle);
    const updated = await fetch(base + '/api/vault', { method:'PUT', headers:{ ...headers, 'If-Match':saved.headers.get('etag') }, body:JSON.stringify(await encrypt(bundle, password)) });
    assert.equal(updated.status, 200);
    assert.equal(fs.readdirSync(backups).length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep + 'moonlit-editor-test-')) throw new Error('Unexpected test path');
    fs.rmSync(directory, { recursive:true });
  }
});
