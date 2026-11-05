import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGuiServer } from '../gui/server.mjs';

test('GUI enforces local session, resolves unknown-size links and dispatches real task lifecycle', async t => {
  let seen;
  const instance = createGuiServer({ download: async options => { seen = options; return { bytes: 17, seconds: .2, md5Verified: false }; } });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  t.after(() => instance.stop());
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  assert.equal((await fetch(`${base}/api/state`)).status, 403);
  assert.match(await (await fetch(base)).text(), /BioDownloader Lite/);
  const headers = { 'X-Lite-Token': instance.token, 'Content-Type': 'application/json' };
  const post = async (path, body) => { const r = await fetch(base + '/api/' + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, data: await r.json() }; };
  const result = await post('resolve', { source: 'links', text: 'https://example.org/a.bin' });
  assert.equal(result.status, 200); assert.equal(result.data.files[0].size, null);
  const directory = await mkdtemp(join(tmpdir(), 'lite-gui-task-'));
  const started = await post('start', { ids: [result.data.files[0].id], engine: 'curl', connections: 1, directory });
  assert.equal(started.status, 200);
  await new Promise(resolve => setTimeout(resolve, 20));
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.equal(state.tasks[0].state, 'completed'); assert.equal(seen.expectedSize, null);
  assert.equal(seen.output, join(directory, 'a.bin'));
  assert.equal((await post('start', { ids: ['bad'], engine: 'curl', connections: 1, directory })).status, 400);
});
