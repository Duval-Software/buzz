import assert from 'node:assert/strict';
import worker from './preview-worker.mjs';

const env = { ASSETS: { fetch: () => new Response('frontend') } };
for (const path of ['/api/identity/bootstrap', '/keeper/health', '/upload', '/push/subscribe']) {
  const response = await worker.fetch(new Request(`https://preview.invalid${path}`, { method: 'POST' }), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match((await response.json()).error, /not connected/);
}
for (const path of ['/chat', '/live', '/pulse', '/onboarding', '/assets/main.js']) {
  assert.equal(await (await worker.fetch(new Request(`https://preview.invalid${path}`), env)).text(), 'frontend');
}
