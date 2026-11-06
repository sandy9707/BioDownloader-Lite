import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const tag = `v${version}`;
if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF !== `refs/tags/${tag}`) throw new Error('Tag/version mismatch');
const names = (await readdir('release-assets')).filter(n => /\.(exe|dmg|zip|AppImage|deb)$/.test(n)).sort();
const expected = ['win32-x64.exe', 'mac-arm64.dmg', 'mac-arm64.zip', 'mac-x64.dmg', 'mac-x64.zip', 'linux-x64.AppImage', 'linux-x64.deb'].sort();
const actual = names.map(n => n.replace(`BioDownloader-Lite-${version}-`, '').replace(/^win-/, 'win32-').replace('linux-x86_64.', 'linux-x64.').replace('linux-amd64.', 'linux-x64.')).sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Expected seven complete platform assets');
const files = [];
for (const name of names) {
  const bytes = (await stat(`release-assets/${name}`)).size;
  if (bytes < 1000000) throw new Error('Empty/truncated installer');
  const hash = createHash('sha256'); for await (const chunk of createReadStream(`release-assets/${name}`)) hash.update(chunk);
  files.push({ name, bytes, sha256: hash.digest('hex') });
}
const commit = process.env.RELEASE_COMMIT || process.env.GITHUB_SHA;
await writeFile('release-assets/release-manifest.json', JSON.stringify({ tag, commit, buildRun: process.env.BUILD_RUN_ID || process.env.GITHUB_RUN_ID, files }, null, 2));
await writeFile('release-assets/SHA256SUMS', files.map(f => `${f.sha256}  ${f.name}\n`).join(''));
execFileSync('gh', ['release', 'create', tag, '--target', commit, '--prerelease', '--title', `BioDownloader Lite ${version} Preview`,
  '--notes', 'Early preview: unsigned/not notarized. All four platform tests and desktop render smoke checks passed. QTrans GUI and restart resume are not yet integrated. Verify SHA256SUMS. See README for current capabilities.',
  ...names.map(n => `release-assets/${n}`), 'release-assets/release-manifest.json', 'release-assets/SHA256SUMS'], { stdio: 'inherit' });
