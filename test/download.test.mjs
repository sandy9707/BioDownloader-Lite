import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { downloadUrl, directEnvironment } from '../src/download.mjs';

test('unknown-size chunked direct link completes; bad checksum/overwrite never published', async t => {
  const body = Buffer.from('real file bytes');
  const server = http.createServer((req, res) => { res.writeHead(200); res.write(body.subarray(0, 4)); res.end(body.subarray(4)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const root = await mkdtemp(join(tmpdir(), 'lite-direct-test-'));
  const url = `http://127.0.0.1:${server.address().port}/file`;
  const output = join(root, 'file');
  const result = await downloadUrl({ url, output, engine: 'curl', md5: createHash('md5').update(body).digest('hex') });
  assert.equal(result.sizeKnown, false); assert.equal(result.md5Verified, true);
  assert.deepEqual(await readFile(output), body);
  await assert.rejects(downloadUrl({ url, output, engine: 'curl' }), /already exists/);
  await assert.rejects(downloadUrl({ url, output: join(root, 'bad'), engine: 'curl', md5: '0'.repeat(32) }), /MD5 mismatch/);
  assert.ok(Object.keys(directEnvironment()).filter(k => /proxy/i.test(k)).every(k => k === 'NO_PROXY'));
});
