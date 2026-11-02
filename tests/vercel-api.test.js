import test from 'node:test';
import assert from 'node:assert/strict';

process.env.VERCEL = '1';
const { default: app } = await import('../api/index.js');

test('Vercel entrypoint exports a working Express API', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const address = server.address();
    const root = `http://127.0.0.1:${address.port}`;
    const health = await fetch(root + '/api/health');
    assert.equal(health.status, 200);
    assert.match(health.headers.get('content-type') || '', /application\/json/);
    const payload = await health.json();
    assert.equal(payload.ok, true);

    const models = await fetch(root + '/demo/v1/models');
    assert.equal(models.status, 200);
    assert.match(models.headers.get('content-type') || '', /application\/json/);
    const missing = await fetch(root + '/api/not-an-endpoint');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).ok, false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
