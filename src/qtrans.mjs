import { runTool } from './download.mjs';

export function validateQtrans(url) {
  const u = new URL(url);
  if (u.protocol !== 'qtrans:' || u.hostname !== 'qt.cncb.ac.cn' || u.username !== 'anonymous' ||
    u.password || (u.port && u.port !== '443') || u.search || u.hash || !/^\/gsa\d*(?:\/|$)/.test(u.pathname)) {
    throw new Error('Expected confirmed public CNCB GSA qtrans URL; arbitrary S3/INSDC paths are not supported');
  }
  return u;
}
// Explicit adapter only: never convert arbitrary HTTP/S3 URL into a QTrans path.
export async function listQtrans({ enginePath, url, signal }) {
  validateQtrans(url);
  if (!enginePath?.startsWith('/')) throw new Error('Absolute verified official engine path required');
  const result = await runTool(enginePath, ['dlist', url, '--transport', 'quic', '--checksum', '--json'], { timeoutMs: 20000, signal });
  if (result.code !== 0 || result.killed) throw new Error(`QTrans listing failed: ${result.stderr.slice(-500)}`);
  const data = JSON.parse(result.stdout);
  if (data.code !== 200 || !Array.isArray(data.entries)) throw new Error('Invalid QTrans directory response');
  return data;
}
