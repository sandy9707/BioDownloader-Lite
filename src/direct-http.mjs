import https from 'node:https';
import { performance } from 'node:perf_hooks';

const cooldowns = new Map();

// Native HTTPS does not consume proxy environment variables or system proxy settings.
// No redirect following: all endpoints and file origins are explicitly checked.
export function request(url, { method = 'GET', headers = {}, maxBytes = 2 * 1024 * 1024, timeoutMs = 15000 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Anonymous HTTPS required');
  if ((cooldowns.get(parsed.hostname) || 0) > Date.now()) return Promise.resolve({
    url: String(url), error: 'host_cooldown', receivedBytes: 0, elapsedMs: 0
  });
  return new Promise(resolve => {
    const start = performance.now();
    let done = false;
    let bytes = 0;
    const chunks = [];
    let timer;
    const finish = data => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ url: String(url), elapsedMs: performance.now() - start, receivedBytes: bytes, ...data });
    };
    const req = https.request(url, {
      method, agent: false,
      headers: { 'User-Agent': 'BioDownloader-Lite/0.1 research', 'Accept-Encoding': 'identity', ...headers }
    }, res => {
      const common = { status: res.statusCode, headers: res.headers };
      if ([429, 503].includes(res.statusCode)) {
        const value = res.headers['retry-after'];
        const deadline = /^\d+$/.test(value || '') ? Date.now() + Number(value) * 1000 : Date.parse(value);
        cooldowns.set(parsed.hostname, Math.max(Date.now() + 60000, Number.isFinite(deadline) ? deadline : 0));
      }
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          finish({ ...common, error: 'body_limit_exceeded' });
          res.destroy();
          req.destroy();
        } else chunks.push(chunk);
      });
      res.on('end', () => finish({ ...common, body: Buffer.concat(chunks) }));
      res.on('error', err => finish({ ...common, error: err.code || err.message }));
    });
    timer = setTimeout(() => {
      finish({ error: 'total_timeout' });
      req.destroy();
    }, timeoutMs);
    req.on('error', err => finish({ error: err.code || err.message }));
    req.end();
  });
}
