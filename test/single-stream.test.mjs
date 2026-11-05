import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadSingle } from '../src/single-stream.mjs';

test('single-stream real local transport: full content, no overwrite, invalid headers, truncation, timeout', async t => {
  const body = Buffer.concat([Buffer.from('NCBI.sra'), Buffer.alloc(2 * 1024 * 1024, 17)]);
  let mode = 'ok', requests = 0, active = 0, maxActive = 0;
  const server = http.createServer((req, res) => {
    requests++;
    active++;
    maxActive = Math.max(maxActive, active);
    res.on('close', () => active--);
    assert.equal(req.headers['if-match'], '"v1"');
    assert.equal(req.headers.range, undefined);
    res.writeHead(mode === 'status' ? 503 : 200, {
      'content-length': body.length, etag: mode === 'changed' ? '"v2"' : '"v1"',
      'content-type': 'application/octet-stream'
    });
    if (mode === 'stall') { res.flushHeaders(); return; }
    if (mode === 'truncated') {
      res.write(body.subarray(0, 8192));
      setTimeout(() => res.destroy(), 10);
    } else res.end(mode === 'bad-magic' ? Buffer.alloc(body.length) : body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = await mkdtemp(join(tmpdir(), 'lite-stream-test-'));
  // Inject HTTP only for the local fixture. Production entrypoint uses HTTPS.
  const request = (url, opts, cb) => http.request({ ...opts, hostname: '127.0.0.1', port: server.address().port, path: '/' }, cb);
  const base = { url: 'https://fixture.invalid/sample', size: body.length, etag: '"v1"', request };
  const output = join(root, 'complete.sra');
  const stats = await downloadSingle({ ...base, output });
  assert.equal(stats.complete, true);
  assert.equal(stats.socketCount, 1);
  assert.deepEqual(await readFile(output), body);
  const before = requests;
  await assert.rejects(downloadSingle({ ...base, output }), /Target exists/);
  assert.equal(requests, before);
  for (mode of ['status', 'changed', 'truncated', 'bad-magic', 'stall']) {
    const file = join(root, mode);
    await assert.rejects(downloadSingle({ ...base, output: file, timeoutMs: mode === 'stall' ? 100 : 2000 }));
    if (mode === 'truncated') assert.ok((await stat(file)).size < body.length);
  }
  const protectedFile = join(root, 'protected');
  await writeFile(protectedFile, 'user data');
  await assert.rejects(downloadSingle({ ...base, output: protectedFile }));
  assert.equal(await readFile(protectedFile, 'utf8'), 'user data');
  assert.equal(maxActive, 1);
});
