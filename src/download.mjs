import { spawn } from 'node:child_process';
import { lstat, mkdtemp, stat, open, link, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from './direct-http.mjs';

export function directEnvironment() {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/proxy/i.test(key))), NO_PROXY: '*' };
}
async function absent(path) {
  try { await lstat(path); throw new Error('Target already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function runTool(command, args, { timeoutMs = 600000, signal, onProgress } = {}) {
  signal?.throwIfAborted();
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { env: directEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', killed = false;
    let hard;
    const stop = () => { killed = true; child.kill('SIGTERM'); hard ??= setTimeout(() => child.kill('SIGKILL'), 5000); };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.stdout.on('data', bytes => { stdout = (stdout + bytes.toString()).slice(-131072); onProgress?.(bytes.toString()); });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-131072); });
    child.on('error', error => { clearTimeout(timer); clearTimeout(hard); signal?.removeEventListener('abort', stop); reject(error); });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer); clearTimeout(hard); signal?.removeEventListener('abort', stop);
      resolveResult({ code, exitSignal, killed, stdout, stderr });
    });
  });
}

export async function downloadUrl({ url, output, engine = 'aria2', connections = 1,
  expectedSize = null, md5 = null, timeoutMs = 600000, signal, onProgress }) {
  const parsed = new URL(url);
  if (!['https:', 'http:', 'ftp:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Anonymous HTTP(S)/FTP URL required');
  if (!['aria2', 'curl'].includes(engine) || ![1, 4].includes(connections)) throw new Error('Invalid engine/connections');
  if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) throw new Error('Invalid expected size');
  if (md5 !== null && !/^[a-f\d]{32}$/i.test(md5)) throw new Error('Invalid MD5');
  output = resolve(output);
  await absent(output);
  // HEAD is advisory. Failure/absent Content-Length is not a download blocker.
  let metadata = { state: 'not_queried' };
  if (parsed.protocol === 'https:') {
    const head = await request(url, { method: 'HEAD', timeoutMs: 10000 });
    metadata = { status: head.status ?? null, error: head.error ?? null,
      size: /^\d+$/.test(head.headers?.['content-length'] || '') ? Number(head.headers['content-length']) : null };
    if (head.status === 200 && expectedSize === null) expectedSize = metadata.size;
  }
  const staging = await mkdtemp(join(dirname(output), '.biodl-lite-'));
  const file = join(staging, 'body');
  const started = performance.now();
  const args = engine === 'curl' ? ['-q', '--proxy', '', '--noproxy', '*', '--fail', '--location', '--max-redirs', '5',
    '--proto', '=http,https,ftp', '--proto-redir', '=http,https,ftp', '--silent', '--show-error',
    '--connect-timeout', '15', '--header', 'Accept-Encoding: identity', '--output', file, url] :
    ['--no-conf=true', '--all-proxy=', '--http-proxy=', '--https-proxy=', '--ftp-proxy=',
      '-x', String(connections), '-s', String(connections), '-k', '1M', '--max-concurrent-downloads=1',
      '--max-tries=1', '--connect-timeout=15', '--timeout=30', '--file-allocation=none',
      '--allow-overwrite=false', '--auto-file-renaming=false', '--http-accept-gzip=false',
      '--enable-color=false', '--summary-interval=1', `--dir=${staging}`, '--out=body', url];
  const result = await runTool(engine === 'curl' ? 'curl' : 'aria2c', args, { timeoutMs, signal, onProgress });
  if (result.code !== 0 || result.killed) throw Object.assign(new Error(`Download incomplete (${result.code}): ${result.stderr.slice(-1000)}`), { staging, result });
  if (engine === 'aria2') {
    try { await stat(file + '.aria2'); throw new Error('Unfinished aria2 state remains'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const actual = await stat(file);
  if (expectedSize !== null && actual.size !== expectedSize) throw Object.assign(new Error('Size mismatch'), { staging });
  const digest = createHash('md5');
  if (md5) {
    for await (const chunk of createReadStream(file)) digest.update(chunk);
    if (digest.digest('hex') !== md5.toLowerCase()) throw Object.assign(new Error('MD5 mismatch'), { staging });
  }
  const handle = await open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
  // Same-filesystem hard link atomically refuses an existing target. A filesystem
  // without hard-link support fails explicitly and preserves staging for recovery.
  await link(file, output);
  return { output, staging, engine, bytes: actual.size, expectedSize, sizeKnown: expectedSize !== null,
    md5Verified: Boolean(md5), seconds: (performance.now() - started) / 1000, metadata,
    validation: md5 ? 'transport and supplied MD5; compare expected size when known' : 'transport completion; no independent source checksum' };
}
