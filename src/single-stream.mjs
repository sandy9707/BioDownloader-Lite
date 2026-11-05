import https from 'node:https';
import { createWriteStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';

// Research control: one full GET, bounded buffering, backpressure, no retries/resume.
// A partial failure is retained and never accepted as an existing resumable file.
export async function downloadSingle({ url, output, size, etag, timeoutMs = 600000,
  request = https.request, bufferBytes = 1024 * 1024 }) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) throw new Error('Anonymous HTTPS required');
  if (!Number.isSafeInteger(size) || size < 8) throw new Error('Expected complete size required');
  if (!/^"[^"\r\n]+"$/.test(etag || '')) throw new Error('Strong expected ETag required');
  if (![65536, 1048576, 4194304].includes(bufferBytes)) throw new Error('Unsupported buffer size');
  try { await lstat(output); throw new Error('Target exists; refusing overwrite/resume'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const start = performance.now();
  const cpu = process.cpuUsage();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('total_timeout')), timeoutMs);
  const stats = { requestCount: 1, socketCount: 0, receivedBytes: 0, bufferBytes,
    intervals: [], ttfbMs: null, remoteAddress: null, retries: 0 };
  let res, req, previousBytes = 0, previousTime = start, prefix = Buffer.alloc(0);
  try {
    res = await new Promise((resolve, reject) => {
      req = request(url, { agent: false, signal: controller.signal,
        headers: { 'Accept-Encoding': 'identity', 'If-Match': etag, 'User-Agent': 'BioDownloader-Lite/0.1 research' }
      }, response => {
        stats.ttfbMs = performance.now() - start;
        stats.status = response.statusCode;
        stats.headers = Object.fromEntries(['content-length', 'etag', 'content-type', 'content-encoding', 'retry-after']
          .filter(k => response.headers[k] !== undefined).map(k => [k, response.headers[k]]));
        stats.remoteAddress = response.socket.remoteAddress;
        resolve(response);
      });
      req.on('socket', () => stats.socketCount++);
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('idle_timeout')));
      req.end();
    });
    if (res.statusCode !== 200 || Number(res.headers['content-length']) !== size ||
      res.headers.etag !== etag || /text\/html/i.test(res.headers['content-type'] || '') ||
      (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity')) {
      throw new Error(`Source contract rejected (HTTP ${res.statusCode})`);
    }
    const meter = new Transform({ highWaterMark: bufferBytes,
      transform(chunk, encoding, callback) {
        stats.receivedBytes += chunk.length;
        if (prefix.length < 8) prefix = Buffer.concat([prefix, chunk.subarray(0, 8 - prefix.length)]);
        if (stats.receivedBytes > size || (prefix.length === 8 && prefix.toString() !== 'NCBI.sra')) {
          callback(new Error('Invalid SRA prefix or excess body bytes'));
          return;
        }
        const now = performance.now();
        if (now - previousTime >= 1000) {
          stats.intervals.push({ elapsedMs: now - start, bytes: stats.receivedBytes - previousBytes,
            durationMs: now - previousTime });
          previousTime = now;
          previousBytes = stats.receivedBytes;
        }
        callback(null, chunk);
      }
    });
    await pipeline(res, meter, createWriteStream(output, {
      flags: 'wx', highWaterMark: bufferBytes, flush: true
    }), { signal: controller.signal });
    if (stats.receivedBytes !== size) throw new Error('Truncated body');
    stats.complete = true;
    return stats;
  } catch (error) {
    stats.complete = false;
    stats.error = error.message;
    error.transferStats = stats;
    throw error;
  } finally {
    clearTimeout(timer);
    res?.destroy();
    req?.destroy();
    stats.elapsedMs = performance.now() - start;
    stats.cpuUsageMicros = process.cpuUsage(cpu);
    stats.maxRssKiB = process.resourceUsage().maxRSS;
  }
}
