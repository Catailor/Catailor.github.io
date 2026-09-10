/* The same Web Crypto implementation runs in the browser and in the safety tests. */
((root) => {
  'use strict';
  const ITERATIONS = 600000;
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
  function toBase64(bytes) {
    let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  }
  function fromBase64(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('加密文件格式不正确');
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
  }
  function validateEnvelope(value) {
    if (!value || Object.keys(value).sort().join(',') !== 'ciphertext,iterations,iv,kdf,salt,version' || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS) throw new Error('不支持的加密文件');
    if (fromBase64(value.salt).length !== 16 || fromBase64(value.iv).length !== 12 || typeof value.ciphertext !== 'string' || value.ciphertext.length > 12000000 || fromBase64(value.ciphertext).length < 16) throw new Error('加密文件损坏或过大');
    return value;
  }
  function validateNotes(bundle) {
    if (!bundle || bundle.version !== 1 || !Array.isArray(bundle.notes) || bundle.notes.length > 500) throw new Error('手记格式不正确');
    const ids = new Set();
    for (const note of bundle.notes) {
      if (!note || typeof note.id !== 'string' || ids.has(note.id) || typeof note.title !== 'string' || typeof note.body !== 'string' || typeof note.date !== 'string' || note.title.length > 200 || note.body.length > 200000) throw new Error('手记内容格式不正确');
      ids.add(note.id);
    }
    return bundle;
  }
  async function derive(password, salt) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(bundle, password) {
    validateNotes(bundle);
    if (typeof password !== 'string' || password.length < 12) throw new Error('请使用至少 12 个字符的独立长密码');
    const data = encoder.encode(JSON.stringify(bundle)); if (data.length > 8000000) throw new Error('手记总大小超过限制');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await derive(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode('moonlit-vault-v1') }, key, data);
    return { version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(encrypted)) };
  }
  async function decrypt(envelope, password) {
    validateEnvelope(envelope);
    const key = await derive(password, fromBase64(envelope.salt));
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: encoder.encode('moonlit-vault-v1') }, key, fromBase64(envelope.ciphertext));
    return validateNotes(JSON.parse(decoder.decode(decrypted)));
  }
  const api = { encrypt, decrypt, validateEnvelope, validateNotes };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoonVault = api;
})(globalThis);
