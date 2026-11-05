import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateAccession, parseCsv, enaFiles } from '../src/metadata.mjs';
const reply = (url, text, status = 200) => ({ url, status, body: Buffer.from(text), headers: {} });
test('CNCB sample experiment-to-run is complete only with confirmed row count', async () => {
  const result = await enumerateAccession('SAMN1', { http: async (url, options) => {
    assert.ok(!url.includes('ncbi'));
    if (url.includes('search?')) return reply(url, '<input id="totalDatas" value="1"><a href="/gsa/browse/insdc/SRA1/SRX1">experiment</a>');
    assert.ok(options.headers.Referer.includes('SAMN1'));
    return reply(url, '<a href="/gsa/browse/insdc/SRA1/SRR1">run</a>');
  } });
  assert.equal(result.provider, 'cncb'); assert.deepEqual(result.runs, ['SRR1']);
});
test('CNCB missing -> NCBI exact BioSample RunInfo; quoted CSV supported', async () => {
  const result = await enumerateAccession('SAMN1', { http: async url => {
    if (url.includes('cncb')) return reply(url, 'no results');
    if (url.includes('esearch')) return reply(url, JSON.stringify({ esearchresult: { count: '1', idlist: ['1'] } }));
    return reply(url, 'Run,BioSample,Name\nSRR1,SAMN1,"a,b"\n');
  } });
  assert.equal(result.provider, 'ncbi'); assert.equal(result.state, 'complete');
  assert.equal(parseCsv('Run,Name\nSRR1,"a,b"\n')[0].Name, 'a,b');
});
test('NCBI unavailable may use ENA but cannot label wrong sample complete', async () => {
  const result = await enumerateAccession('SAMN1', { http: async url => {
    if (url.includes('cncb')) return reply(url, '');
    if (url.includes('esearch')) return reply(url, JSON.stringify({ esearchresult: { count: '1', idlist: ['1'] } }));
    if (url.includes('efetch')) return reply(url, 'Run,BioSample\nSRR1,SAMN2\n');
    return reply(url, '[{"run_accession":"SRR2"}]');
  } });
  assert.equal(result.provider, 'ena'); assert.deepEqual(result.runs, ['SRR2']);
});
test('ENA files keep paired URLs sizes MD5 aligned and reject foreign hosts', async () => {
  const result = await enaFiles('SRR1', { http: async url => reply(url, JSON.stringify([{ run_accession: 'SRR1',
    fastq_ftp: 'evil.test/x.gz', fastq_bytes: '12', fastq_md5: 'a'.repeat(32) }])) });
  assert.equal(result.state, 'invalid_metadata');
});
