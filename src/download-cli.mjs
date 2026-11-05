import { downloadUrl } from './download.mjs';
const args = process.argv.slice(2);
if (args.length < 2 || args.includes('--help')) {
  console.log('BioDownloader Lite: node lite/src/download-cli.mjs URL NEW_OUTPUT [--engine aria2|curl] [--connections 1|4] [--size BYTES] [--md5 HASH]');
} else {
  try {
    const [url, output] = args.splice(0, 2);
    const options = { url, output };
    while (args.length) {
      const key = args.shift(), value = args.shift();
      if (key === '--engine') options.engine = value;
      else if (key === '--connections') options.connections = Number(value);
      else if (key === '--size') options.expectedSize = Number(value);
      else if (key === '--md5') options.md5 = value;
      else if (key === '--timeout-seconds' && Number(value) > 0 && Number(value) <= 600) options.timeoutMs = Number(value) * 1000;
      else throw new Error(`Invalid option ${key}`);
    }
    console.log(JSON.stringify(await downloadUrl(options), null, 2));
  } catch (error) { console.error(JSON.stringify({ error: error.message, staging: error.staging })); process.exitCode = 1; }
}
