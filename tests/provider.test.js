import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseUrl, buildBaseCandidates, normalizeApiKey } from '../server/provider.js';

test('API keys are normalized safely', () => {
  assert.equal(normalizeApiKey('Bearer sample_key'), 'sample_key');
});
test('base URLs normalize correctly in development', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    assert.equal(normalizeBaseUrl('https://api.example.com/v1/models'), 'https://api.example.com/v1');
    assert.deepEqual(buildBaseCandidates('https://api.example.com'), ['https://api.example.com', 'https://api.example.com/v1']);
    assert.throws(() => normalizeBaseUrl('file:///etc/passwd'));
  } finally { if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev; }
});
test('production accepts dynamic public HTTPS hosts and rejects unsafe URLs', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.equal(normalizeBaseUrl('https://provider.example.net/v1'), 'https://provider.example.net/v1');
    assert.throws(() => normalizeBaseUrl('http://provider.example.net/v1'), /HTTPS publik/);
    assert.throws(() => normalizeBaseUrl('https://localhost/v1'), /HTTPS publik/);
    assert.throws(() => normalizeBaseUrl('https://127.0.0.1/v1'), /HTTPS publik/);
    assert.throws(() => normalizeBaseUrl('https://user:pass@provider.example.net/v1'), /kredensial/);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
  }
});
