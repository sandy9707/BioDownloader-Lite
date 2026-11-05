import { VERSION, isRun, isProject, resolveRun } from './resolver.mjs';
import { writeFile } from 'node:fs/promises';
import { enumerateAccession, isSample, enaFiles } from './metadata.mjs';

const args = process.argv.slice(2);
if (!args.length || args.includes('--help')) {
  console.log('BioDownloader Lite 0.1: node lite/src/cli.mjs SRR...|PRJNA...|SAMN... [--max-runs 2] [--format sra|fastq] [--domestic-url HTTPS_URL] [--output NEW_JSON]\nProbes SRA prefixes or returns official ENA FASTQ metadata. Projects/samples default to 2-run preview.');
} else {
  try {
    const accession = args.shift().toUpperCase();
    let maxRuns = 2, domesticUrl, output, format = 'sra';
    while (args.length) {
      const key = args.shift(), value = args.shift();
      if (key === '--max-runs' && /^\d+$/.test(value || '') && +value >= 1 && +value <= 20) maxRuns = +value;
      else if (key === '--domestic-url' && value) domesticUrl = value;
      else if (key === '--output' && value) output = value;
      else if (key === '--format' && ['sra', 'fastq'].includes(value)) format = value;
      else throw new Error(`Invalid option: ${key}`);
    }
    const result = { version: VERSION, timestamp: new Date().toISOString(),
      transport: 'native HTTPS; no application proxy; transparent network path not certified',
      validation: format === 'fastq' ? 'official ENA file metadata only; file readability not certified' : '4096-byte SRA prefix only; not full integrity or speed test' };
    const resolveSelected = async run => format === 'fastq' ? { run, provider: 'ena', ...(await enaFiles(run)) } : resolveRun(run, { domesticUrl });
    if (isRun(accession)) result.result = await resolveSelected(accession);
    else if (isProject(accession) || isSample(accession)) {
      if (domesticUrl) throw new Error('--domestic-url requires one run');
      const project = await enumerateAccession(accession);
      result.project = project;
      result.resolved = [];
      for (const run of project.runs.slice(0, maxRuns)) result.resolved.push(await resolveSelected(run));
      result.selectionComplete = project.state === 'complete' && result.resolved.length === project.runs.length;
    } else throw new Error('Supported input: SRR/ERR/DRR, BioProject PRJNA/PRJEB/PRJDB, BioSample SAMN/SAMEA/SAMD');
    const json = JSON.stringify(result, null, 2);
    if (output) await writeFile(output, json + '\n', { flag: 'wx' });
    console.log(json);
    const good = r => format === 'fastq' ? r.state === 'files_confirmed' : Boolean(r.selected);
    if (result.result ? !good(result.result) : !result.resolved.length || result.resolved.some(r => !good(r))) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
