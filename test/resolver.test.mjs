import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRun, probe, enumerateProject, isDomesticFile } from '../src/resolver.mjs';

const run = 'SRR20710520';
const file = `https://download2.cncb.ac.cn/INSDC5/SRA/20/SRR20710/${run}/${run}.sra`;
const page = `https://ngdc.cncb.ac.cn/gsa/browse/insdc/SRA1465176/${run}`;
const response = (url, body, status = 200, headers = {}) => ({ url, status, headers, body: Buffer.from(body), receivedBytes: Buffer.byteLength(body), elapsedMs: 1 });
const sample = url => response(url, Buffer.concat([Buffer.from('NCBI.sra'), Buffer.alloc(4088)]), 206,
  { 'content-range': 'bytes 0-4095/10000', 'content-type': 'application/octet-stream' });

test('official domestic discovery wins without contacting AWS', async () => {
  const seen = [];
  const result = await resolveRun(run, { http: async (url, options) => {
    seen.push(url);
    if (url === page) assert.equal(options.headers.Referer, `https://ngdc.cncb.ac.cn/gsa/search?searchTerm=${run}`);
    return url.includes('/search?') ? response(url, `<a href="${page}">run</a>`) :
      url === page ? response(url, `<a href="${file}">file</a>`) : sample(url);
  } });
  assert.equal(result.selected, 'cncb');
  assert.equal(seen.length, 3);
  assert.ok(seen.every(u => !u.includes('amazonaws')));
});

test('HTTP 200 verification page is unknown, not missing; AWS must be readable', async () => {
  const result = await resolveRun(run, { http: async url => url.includes('amazonaws') ? sample(url) : response(url, '<title>SecurityCheck</title>') });
  assert.equal(result.domestic.state, 'browser_verification_required');
  assert.equal(result.selected, 'aws');
});

test('503 keeps Retry-After and falls back without retrying domestic', async () => {
  let attempts = 0;
  const result = await resolveRun(run, { domesticUrl: file, http: async url => {
    if (url === file) { attempts++; return response(url, '', 503, { 'retry-after': '60' }); }
    return sample(url);
  } });
  assert.equal(attempts, 1);
  assert.equal(result.domestic.probe.state, 'rate_limited');
  assert.equal(result.domestic.probe.headers['retry-after'], '60');
  assert.equal(result.selected, 'aws');
});

test('reject ignored Range, HTML, bad lengths, invalid magic, and failed AWS', async () => {
  for (const r of [response(file, 'NCB', 200), response(file, '<html/>', 206),
    response(file, Buffer.alloc(4096), 206, { 'content-range': 'bytes 0-4095/10000' })]) {
    assert.notEqual((await probe(file, async () => r)).state, 'readable_sample');
  }
  const r = await resolveRun(run, { http: async url => response(url, '', 404) });
  assert.equal(r.selected, null);
});

test('host lookalikes, other runs and guessed ERR AWS are rejected', async () => {
  assert.equal(isDomesticFile(file.replace(`/${run}.sra`, `//${run}.sra`), run), true);
  assert.equal(isDomesticFile(file.replace('cncb.ac.cn', 'cncb.ac.cn.evil.test'), run), false);
  assert.equal(isDomesticFile(file, 'SRR1'), false);
  await assert.rejects(resolveRun(run, { domesticUrl: 'https://evil.test/a' }));
  const result = await resolveRun('ERR123', { http: async url => response(url, '') });
  assert.equal(result.aws.state, 'unsupported_accession');
});

test('project listing reports caps and does not mistake experiments for runs', async () => {
  const result = await enumerateProject('PRJNA727404', { cap: 1, http: async url =>
    url.includes('ebi.ac.uk') ? response(url, JSON.stringify([{ run_accession: 'SRR1' }, { run_accession: 'SRR2' }])) : response(url, '<a>SRX123</a>') });
  assert.equal(result.state, 'truncated');
  assert.deepEqual(result.runs, ['SRR1']);
});
