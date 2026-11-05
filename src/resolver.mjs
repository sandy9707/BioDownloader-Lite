import { request } from './direct-http.mjs';
import { createHash } from 'node:crypto';

export const VERSION = '0.1.0';
export const isRun = value => /^(SRR|ERR|DRR)\d+$/.test(value);
export const isProject = value => /^PRJ(NA|EB|DB)\d+$/.test(value);
export const challenge = text => /SecurityCheck|Verifying your browser|captcha/i.test(text);

export function links(html, base) {
  return [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].flatMap(match => {
    try { return [new URL(match[1].replaceAll('&amp;', '&'), base).href]; } catch { return []; }
  });
}

export function isDomesticFile(url, run) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'download2.cncb.ac.cn' &&
      !u.port && !u.username && !u.password && !u.search && !u.hash &&
      new RegExp(`^/INSDC\\d*/SRA/[^/]+/[^/]+/${run}//?${run}(?:\\.sra)?$`).test(u.pathname);
  } catch { return false; }
}

const summary = r => ({ url: r.url, status: r.status ?? null, error: r.error ?? null,
  elapsedMs: r.elapsedMs, receivedBytes: r.receivedBytes,
  headers: Object.fromEntries(['content-length', 'content-type', 'content-range', 'etag', 'last-modified', 'retry-after', 'location']
    .filter(k => r.headers?.[k] !== undefined).map(k => [k, r.headers[k]])) });

export async function probe(url, http = request) {
  const r = await http(url, { headers: { Range: 'bytes=0-4095' }, maxBytes: 4096 });
  const range = /^bytes 0-4095\/(\d+)$/.exec(r.headers?.['content-range'] || '');
  const size = range ? Number(range[1]) : null;
  const ok = !r.error && r.status === 206 && r.body?.length === 4096 && size >= 4096 &&
    (!r.headers['content-encoding'] || r.headers['content-encoding'] === 'identity') &&
    !/text\/html/i.test(r.headers['content-type'] || '') && r.body.subarray(0, 8).toString() === 'NCBI.sra';
  return { state: ok ? 'readable_sample' : [429, 503].includes(r.status) ? 'rate_limited' :
    [404, 410].includes(r.status) ? 'not_found' : 'unverified', size,
    prefixSha256: ok ? createHash('sha256').update(r.body).digest('hex') : null, ...summary(r) };
}

export async function discoverDomestic(run, http = request) {
  const url = `https://ngdc.cncb.ac.cn/gsa/search?searchTerm=${run}`;
  const first = await http(url);
  const evidence = [summary(first)];
  if (first.error || first.status !== 200) return { state: 'query_unavailable', evidence };
  if (challenge(first.body.toString())) return { state: 'browser_verification_required', evidence };
  const detail = links(first.body.toString(), 'https://ngdc.cncb.ac.cn/gsa/').find(link => {
    const u = new URL(link);
    return u.origin === 'https://ngdc.cncb.ac.cn' && new RegExp(`^/gsa/browse/insdc/[^/]+/${run}$`).test(u.pathname);
  });
  if (!detail) return { state: 'no_exact_run_link', evidence };
  // Follow the exact search-result link with its actual same-site source page.
  // No browser cookie, generated token or user-agent impersonation is needed.
  const page = await http(detail, { headers: { Referer: url } });
  evidence.push(summary(page));
  if (page.error || page.status !== 200) return { state: 'detail_unavailable', evidence };
  if (challenge(page.body.toString())) return { state: 'browser_verification_required', evidence };
  const files = [...new Set(links(page.body.toString(), detail).filter(link => isDomesticFile(link, run)))];
  // Fail closed on ambiguous file choices; never guess an INSDC storage shard.
  return files.length === 1 ? { state: 'official_file_link', url: files[0], evidence } :
    { state: files.length ? 'ambiguous_files' : 'no_official_file_link', evidence };
}

export async function resolveRun(run, { http = request, domesticUrl } = {}) {
  if (!isRun(run)) throw new Error('Expected SRR/ERR/DRR run accession');
  if (domesticUrl && !isDomesticFile(domesticUrl, run)) throw new Error('Invalid CNCB file URL for this run');
  const domestic = domesticUrl ? { state: 'explicit_user_link', url: domesticUrl, evidence: [] } : await discoverDomestic(run, http);
  if (domestic.url) {
    domestic.probe = await probe(domestic.url, http);
    if (domestic.probe.state === 'readable_sample') return { run, selected: 'cncb', url: domestic.url, domestic };
  }
  // This public bucket template is for SRR only. Do not fabricate ERR/DRR AWS paths.
  if (!/^SRR/.test(run)) return { run, selected: null, domestic, aws: { state: 'unsupported_accession' } };
  const url = `https://sra-pub-run-odp.s3.amazonaws.com/sra/${run}/${run}`;
  const aws = await probe(url, http);
  return { run, selected: aws.state === 'readable_sample' ? 'aws' : null,
    url: aws.state === 'readable_sample' ? url : null, domestic, aws };
}

export async function enumerateProject(project, { http = request, cap = 1000 } = {}) {
  if (!isProject(project)) throw new Error('Expected PRJNA/PRJEB/PRJDB accession');
  const domesticUrl = `https://ngdc.cncb.ac.cn/bioproject/browse/insdc/${project}`;
  const cn = await http(domesticUrl);
  const domestic = { ...summary(cn), state: cn.error || cn.status !== 200 ? 'query_unavailable' :
    challenge(cn.body.toString()) ? 'browser_verification_required' : 'metadata_only' };
  // Domestic project pages list experiments, not a proven complete run list.
  // ENA supplies bounded run enumeration; it is metadata, not the selected file host.
  const params = new URLSearchParams({ result: 'read_run', query: `study_accession="${project}"`,
    fields: 'run_accession', format: 'json', limit: String(cap + 1) });
  const r = await http(`https://www.ebi.ac.uk/ena/portal/api/search?${params}`);
  if (r.error || r.status !== 200) return { project, domestic, enumeration: summary(r), state: 'enumeration_unavailable', runs: [] };
  let rows;
  try { rows = JSON.parse(r.body.toString()); } catch { throw new Error('Invalid ENA metadata JSON'); }
  if (!Array.isArray(rows) || rows.some(row => !isRun(row.run_accession))) throw new Error('Unexpected ENA run schema');
  const runs = [...new Set(rows.map(row => row.run_accession))].sort();
  return { project, domestic, enumeration: summary(r), state: rows.length > cap ? 'truncated' : 'complete', runs: runs.slice(0, cap) };
}
