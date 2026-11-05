import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
assert.equal(pkg.build.appId, 'org.biodownloader.lite');
assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
assert.equal(pkg.build.publish, null);
assert.ok(!JSON.stringify(pkg.build).match(/mihomo|clash|Country\.mmdb|GeoSite/i));
for (const path of ['desktop/main.cjs', 'gui/server.mjs', 'gui/index.html', 'src/download.mjs']) await stat(new URL('../' + path, import.meta.url));
console.log('Desktop packaging contract passed');
