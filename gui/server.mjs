import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolveRun, isRun, isProject } from '../src/resolver.mjs';
import { enumerateAccession, isSample, enaFiles } from '../src/metadata.mjs';
import { downloadUrl, runTool } from '../src/download.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
export function createGuiServer({ download = downloadUrl } = {}) {
  const token = randomBytes(24).toString('hex'), tasks = [], logs = [], candidates = new Map();
  const directory = join(homedir(), 'Downloads', 'BioDownloader-Lite');
  let resolving = false, closing = false;
  const log = message => { logs.push({ time: new Date().toISOString(), message }); if (logs.length > 300) logs.shift(); };
  const safeError = error => String(error.message).replace(/(?:https?|ftp):\/\/[^\s]+/g, '[文件地址]').slice(0, 1200);
  const publicTask = t => ({ id: t.id, name: t.file.name, provider: t.file.provider, size: t.file.size,
    state: t.state, progress: t.progress, detail: t.detail, output: t.output, startedAt: t.startedAt });
  async function pump() {
    if (closing || tasks.some(t => t.state === 'running')) return;
    const t = tasks.find(t => t.state === 'queued');
    if (!t) return;
    t.state = 'running'; t.startedAt = Date.now(); t.controller = new AbortController(); log(`开始：${t.file.name}`);
    try {
      const result = await download({ url: t.file.url, output: t.output, engine: t.engine,
        connections: t.file.provider === 'CNCB' ? 1 : t.connections,
        expectedSize: t.file.size, md5: t.file.md5, signal: t.controller.signal,
        onProgress: text => {
          const matches = [...text.matchAll(/\((\d+)%\)/g)];
          if (matches.length) t.progress = Math.min(99, Number(matches.at(-1)[1]));
        } });
      t.state = 'completed'; t.progress = 100; t.detail = `${result.bytes.toLocaleString()} 字节 · ${result.seconds.toFixed(1)} 秒${result.md5Verified ? ' · MD5 通过' : ' · 传输完成'}`;
      log(`完成：${t.file.name}`);
    } catch (error) {
      t.state = t.controller.signal.aborted ? 'cancelled' : 'failed';
      t.detail = t.state === 'cancelled' ? '已取消；暂存保留。重试将新建下载。' : safeError(error);
      log(`${t.state === 'cancelled' ? '取消' : '失败'}：${t.file.name} — ${t.detail}`);
    } finally { t.controller = null; pump(); }
  }
  function addFile(file) {
    const id = randomUUID(); candidates.set(id, { ...file, id }); return { ...file, id, url: undefined };
  }
  async function query(source, text) {
    const results = [], warnings = [], seen = new Set();
    const inputs = [...new Set(text.trim().split(source === 'links' ? /\r?\n/ : /[\s,，]+/).map(s => s.trim()).filter(Boolean))];
    if (!inputs.length || inputs.length > 20) throw new Error('每次请输入 1–20 个编号或链接。');
    for (const input of inputs) {
      if (source === 'links') {
        const u = new URL(input);
        if (!['https:', 'http:', 'ftp:'].includes(u.protocol) || u.username || u.password) throw new Error('仅支持不含账号密码的 HTTP(S) / FTP 文件链接。');
        let name;
        try { name = decodeURIComponent(basename(u.pathname)); } catch { name = basename(u.pathname); }
        name = name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').replace(/^\.+$/, '') || 'download.bin';
        results.push(addFile({ name, provider: u.hostname, url: input, size: null, md5: null }));
        continue;
      }
      const accession = input.toUpperCase();
      let runs;
      if (isRun(accession)) runs = [accession];
      else if (isProject(accession) || isSample(accession)) {
        const meta = await enumerateAccession(accession, { cap: 100 });
        if (meta.state !== 'complete') { warnings.push(`${accession}：未取得完整 Run 清单（${meta.state}），未自动加入。`); continue; }
        runs = meta.runs; log(`${accession}：${meta.provider} 返回 ${runs.length} 个 Run`);
      } else throw new Error(`不支持的编号：${accession}`);
      if (seen.size + runs.filter(r => !seen.has(r)).length > 100) throw new Error('单次展开超过 100 个 Run，请缩小项目范围。');
      for (const run of runs) {
        if (seen.has(run)) continue; seen.add(run);
        if (source === 'ena') {
          const found = await enaFiles(run);
          if (!found.files.length) { warnings.push(`${run}：未取得 ENA FASTQ 文件。`); continue; }
          for (const file of found.files) results.push(addFile({ ...file, name: basename(new URL(file.url).pathname), provider: 'ENA' }));
        } else {
          const found = await resolveRun(run);
          if (!found.selected) { warnings.push(`${run}：暂未确认可用文件。`); continue; }
          results.push(addFile({ name: `${run}.sra`, provider: found.selected === 'cncb' ? 'CNCB' : 'AWS', url: found.url,
            size: found.selected === 'cncb' ? found.domestic.probe.size : found.aws.size, md5: null }));
        }
      }
    }
    return { files: results, warnings };
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== expectedHost) return json(403, { error: 'Invalid host' });
      const path = new URL(req.url, `http://${expectedHost}`).pathname;
      if (path.startsWith('/api/')) {
        if (req.headers['x-lite-token'] !== token || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) return json(403, { error: 'Invalid local session' });
        if (req.method === 'GET' && path === '/api/state') return json(200, { tasks: tasks.map(publicTask), logs });
        if (req.method === 'GET' && path === '/api/config') {
          const tools = {};
          for (const cmd of ['aria2c', 'curl']) { try { const r = await runTool(cmd, ['--version'], { timeoutMs: 4000 }); tools[cmd] = r.code === 0; } catch { tools[cmd] = false; } }
          return json(200, { directory, tools });
        }
        if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw new Error('Request too large'); }
        const body = JSON.parse(raw || '{}');
        if (path === '/api/resolve') {
          if (resolving) return json(409, { error: '已有查询进行中。' });
          if (!['sra', 'ena', 'links'].includes(body.source) || typeof body.text !== 'string') throw new Error('Invalid query');
          if (candidates.size > 2000) throw new Error('本次会话队列过多，请重启本机 GUI。');
          resolving = true;
          try { return json(200, await query(body.source, body.text)); } finally { resolving = false; }
        }
        if (path === '/api/start') {
          if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > 200 || !['aria2', 'curl'].includes(body.engine) || ![1, 4].includes(body.connections)) throw new Error('Invalid task options');
          const target = resolve(body.directory || '');
          if (!body.directory || !body.directory.startsWith('/')) throw new Error('请填写目标文件夹的绝对路径。');
          if (target === directory) await mkdir(target, { recursive: true });
          if (!(await stat(target)).isDirectory()) throw new Error('目标不是文件夹。');
          const files = [...new Set(body.ids)].map(id => { const file = candidates.get(id); if (!file) throw new Error('队列已失效，请重新查询。'); return file; });
          const paths = files.map(f => join(target, f.name));
          if (new Set(paths).size !== paths.length) throw new Error('存在同名文件，请分批下载到不同目录。');
          if (paths.some(p => tasks.some(t => ['queued', 'running'].includes(t.state) && t.output === p))) throw new Error('相同路径已有任务。');
          for (const file of files) tasks.push({ id: randomUUID(), file, output: join(target, file.name), engine: body.engine, connections: body.connections, state: 'queued', progress: 0, detail: '等待下载' });
          pump(); return json(200, { added: files.length });
        }
        if (path === '/api/cancel') { const t = tasks.find(t => t.id === body.id); if (!t) throw new Error('Task not found'); if (t.state === 'queued') t.state = 'cancelled'; else t.controller?.abort(); return json(200, { ok: true }); }
        if (path === '/api/clear') { for (let i = tasks.length - 1; i >= 0; i--) if (!['running', 'queued'].includes(tasks[i].state)) tasks.splice(i, 1); return json(200, { ok: true }); }
        return json(404, { error: 'Not found' });
      }
      const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/app.js': ['app.js', 'text/javascript'] };
      if (!files[path]) return json(404, { error: 'Not found' });
      const [file, type] = files[path]; let content = await readFile(join(ROOT, file), 'utf8');
      if (file === 'index.html') content = content.replace('</head>', `<meta name="lite-token" content="${token}"></head>`);
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(content);
    } catch (error) { json(400, { error: safeError(error) }); }
  });
  return { server, token, stop() { closing = true; tasks.forEach(t => t.controller?.abort()); server.close(); }, tasks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const instance = createGuiServer();
  instance.server.listen(Number(process.env.LITE_PORT || 17836), '127.0.0.1', () => console.log(`BioDownloader Lite GUI: http://127.0.0.1:${instance.server.address().port}`));
  instance.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  process.on('SIGINT', () => instance.stop()); process.on('SIGTERM', () => instance.stop());
}
