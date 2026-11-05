import { request } from './direct-http.mjs';
import { challenge, links, isRun, isProject } from './resolver.mjs';

export const isSample = value => /^(SAMN|SAMEA|SAMD)\d+$/.test(value);
const brief = r => ({ url: r.url, status: r.status ?? null, error: r.error ?? null });

export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if (c === '\n' && !quoted) { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('Truncated CSV');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  const header = rows.shift() || [];
  if (header[0] !== 'Run') throw new Error('NCBI did not return RunInfo');
  return rows.filter(r => r.length > 1).map(values => Object.fromEntries(header.map((key, i) => [key, values[i]])));
}

export async function enumerateAccession(accession, { http = request, cap = 1000 } = {}) {
  if (!isSample(accession) && !isProject(accession)) throw new Error('Expected BioSample or BioProject');
  const evidence = [];
  const search = `https://ngdc.cncb.ac.cn/gsa/search?searchTerm=${accession}`;
  const cn = await http(search);
  evidence.push({ provider: 'cncb', ...brief(cn) });
  const cnRuns = new Set();
  let domesticState = 'unavailable';
  if (!cn.error && cn.status === 200 && !challenge(cn.body.toString())) {
    const html = cn.body.toString();
    const details = [...new Set(links(html, search).filter(link => {
      const u = new URL(link);
      return u.origin === 'https://ngdc.cncb.ac.cn' && /^\/gsa\/browse\/insdc\/[^/]+\/(SR[RX]|ER[RX]|DR[RX])\d+$/.test(u.pathname);
    }))];
    const total = /id=["']totalDatas["'][^>]*value=["'](\d+)/.exec(html) || /totalDatas'\)\.value\s*=\s*'(\d+)'/.exec(html);
    // Search returns experiment rows; visit all available rows but never call a
    // partial page a complete project. NCBI/ENA can supply a complete fallback.
    let allRead = true;
    for (const detail of details.slice(0, Math.min(cap, 50))) {
      if (isRun(detail.split('/').at(-1))) cnRuns.add(detail.split('/').at(-1));
      else {
        const r = await http(detail, { headers: { Referer: search } });
        evidence.push({ provider: 'cncb', ...brief(r) });
        if (r.error || r.status !== 200 || challenge(r.body.toString())) { allRead = false; continue; }
        for (const link of links(r.body.toString(), detail)) {
          const u = new URL(link), run = u.pathname.split('/').at(-1);
          if (u.origin === 'https://ngdc.cncb.ac.cn' && /^\/gsa\/browse\/insdc\//.test(u.pathname) && isRun(run)) cnRuns.add(run);
        }
      }
    }
    domesticState = cnRuns.size ? 'partial' : 'no_runs_confirmed';
    if (allRead && total && Number(total[1]) > 0 && Number(total[1]) === details.length && details.length <= Math.min(cap, 50) && cnRuns.size && cnRuns.size <= cap) {
      return { accession, provider: 'cncb', state: 'complete', runs: [...cnRuns].sort(), evidence };
    }
  } else if (!cn.error && challenge(cn.body?.toString() || '')) domesticState = 'verification_required';

  const field = isProject(accession) ? 'BioProject' : 'BioSample';
  const params = new URLSearchParams({ db: 'sra', term: `${accession}[${field}]`, retmode: 'json', retmax: String(cap + 1) });
  // Small bounded retries for transient NCBI 5xx; respect rate limiting (no retry).
  let ncbi;
  for (let attempt = 0; attempt < 2; attempt++) {
    ncbi = await http(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params}`);
    evidence.push({ provider: 'ncbi', ...brief(ncbi) });
    if (ncbi.status !== 500 && ncbi.status !== 502 && !ncbi.error) break;
    if (!attempt) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  try {
    if (ncbi.error || ncbi.status !== 200) throw new Error('NCBI search unavailable');
    const result = JSON.parse(ncbi.body.toString()).esearchresult;
    if (!result || !Array.isArray(result.idlist)) throw new Error('Invalid NCBI schema');
    const runs = new Set();
    let valid = true;
    for (let i = 0; i < result.idlist.length; i += 100) {
      const ids = result.idlist.slice(i, i + 100);
      if (ids.some(id => !/^\d+$/.test(id))) throw new Error('Invalid NCBI UID');
      const r = await http(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=sra&id=${ids.join(',')}&rettype=runinfo&retmode=text`);
      evidence.push({ provider: 'ncbi', ...brief(r) });
      if (r.error || r.status !== 200) throw new Error('NCBI RunInfo unavailable');
      const records = parseCsv(r.body.toString());
      if (!records.length) throw new Error('Empty NCBI RunInfo batch');
      for (const row of records) {
        if (!isRun(row.Run) || row[field] !== accession) { valid = false; continue; }
        runs.add(row.Run);
      }
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (valid && runs.size) return { accession, provider: 'ncbi', state: Number(result.count) > result.idlist.length || runs.size > cap ? 'truncated' : 'complete',
      domesticState, runs: [...runs].sort().slice(0, cap), evidence };
  } catch (error) { evidence.push({ provider: 'ncbi', error: error.message }); }
  // Tertiary metadata fallback; ENA file selection remains a separate decision.
  const query = isProject(accession) ? 'study_accession' : 'sample_accession';
  const enaParams = new URLSearchParams({ result: 'read_run', query: `${query}="${accession}"`, fields: 'run_accession', format: 'json', limit: String(cap + 1) });
  const ena = await http(`https://www.ebi.ac.uk/ena/portal/api/search?${enaParams}`);
  evidence.push({ provider: 'ena', ...brief(ena) });
  try {
    if (ena.error || ena.status !== 200) throw new Error('ENA unavailable');
    const rows = JSON.parse(ena.body.toString());
    if (!Array.isArray(rows) || rows.some(r => !isRun(r.run_accession))) throw new Error('Invalid ENA schema');
    return { accession, provider: 'ena', state: rows.length > cap ? 'truncated' : rows.length ? 'complete' : 'no_runs_confirmed',
      domesticState, runs: [...new Set(rows.map(r => r.run_accession))].sort().slice(0, cap), evidence };
  } catch (error) {
    return { accession, provider: null, state: 'enumeration_unavailable', domesticState, runs: [...cnRuns].sort().slice(0, cap), evidence };
  }
}

export async function enaFiles(run, { http = request } = {}) {
  if (!isRun(run)) throw new Error('Expected Run');
  const p = new URLSearchParams({ accession: run, result: 'read_run', fields: 'run_accession,fastq_ftp,fastq_bytes,fastq_md5', format: 'json' });
  const r = await http(`https://www.ebi.ac.uk/ena/portal/api/filereport?${p}`);
  if (r.error || r.status !== 200) return { state: 'metadata_unavailable', evidence: brief(r), files: [] };
  try {
    const rows = JSON.parse(r.body.toString());
    const row = rows.find(row => row.run_accession === run);
    if (!row) return { state: 'no_files_confirmed', files: [] };
    const paths = row.fastq_ftp?.split(';').filter(Boolean) || [], sizes = row.fastq_bytes?.split(';') || [], hashes = row.fastq_md5?.split(';') || [];
    if (paths.length !== sizes.length || paths.length !== hashes.length) throw new Error('Misaligned ENA fields');
    const files = paths.map((path, i) => {
      const url = new URL(`https://${path}`);
      if (url.hostname !== 'ftp.sra.ebi.ac.uk' || !/^\/vol1\/fastq\//.test(url.pathname) || !/^[a-f0-9]{32}$/.test(hashes[i]) || !/^\d+$/.test(sizes[i])) throw new Error('Invalid ENA file');
      return { url: url.href, format: 'fastq.gz', size: Number(sizes[i]), md5: hashes[i] };
    });
    return { state: files.length ? 'files_confirmed' : 'no_files_confirmed', evidence: brief(r), files };
  } catch (error) { return { state: 'invalid_metadata', error: error.message, files: [] }; }
}
