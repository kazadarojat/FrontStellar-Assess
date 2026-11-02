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
test('production enforces explicitly allowed HTTPS provider hostnames', () => {
  const prev = process.env.NODE_ENV;
  const hosts = process.env.ALLOWED_PROVIDER_HOSTS;
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_PROVIDER_HOSTS = 'api.example.com';
  try {
    assert.equal(normalizeBaseUrl('https://api.example.com/v1'), 'https://api.example.com/v1');
    assert.throws(() => normalizeBaseUrl('https://internal.example.net/v1'), /tidak diizinkan/);
    assert.throws(() => normalizeBaseUrl('http://api.example.com/v1'), /tidak diizinkan/);
    assert.throws(() => normalizeBaseUrl('https://user:pass@api.example.com/v1'), /kredensial/);
  } finally {
    if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev;
    if (hosts === undefined) delete process.env.ALLOWED_PROVIDER_HOSTS; else process.env.ALLOWED_PROVIDER_HOSTS = hosts;
  }
});
