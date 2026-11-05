const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="lite-token"]').content;
let source = 'sra', files = [], tasks = [], logs = [], filter = 'all', config;
const labels = { queued: '排队中', running: '正在下载', completed: '已完成', failed: '失败', cancelled: '已取消' };
const sizes = bytes => bytes === null || bytes === undefined ? '大小未知' : bytes < 1e6 ? `${(bytes / 1000).toFixed(1)} KB` : bytes < 1e9 ? `${(bytes / 1e6).toFixed(2)} MB` : `${(bytes / 1e9).toFixed(2)} GB`;
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
function notice(text, error = false) { $('notice').textContent = text; $('notice').hidden = !text; $('notice').className = error ? 'error' : ''; }
async function api(path, body) {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Lite-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '本机服务请求失败'); return data;
}
function view(name) {
  document.querySelectorAll('.view').forEach(node => node.hidden = node.id !== name);
  document.querySelectorAll('.nav').forEach(node => node.classList.toggle('active', node.dataset.view === name));
  $('pageTitle').textContent = { hub: '下载中心', transfers: '传输列表', logs: '运行日志', settings: '设置' }[name];
  $('pageSubtitle').textContent = { hub: '查询来源，确认文件，再开始下载。', transfers: '逐个传输，随时查看状态。', logs: '本次会话的查询与传输记录。', settings: '选择适合当前来源的下载方式。' }[name];
}
document.querySelectorAll('.nav').forEach(button => button.onclick = () => view(button.dataset.view));
document.querySelectorAll('.source').forEach(button => button.onclick = () => {
  source = button.dataset.source;
  document.querySelectorAll('.source').forEach(node => node.classList.toggle('active', node === button));
  const direct = source === 'links';
  $('inputLabel').textContent = direct ? '文件下载链接（每行一个）' : source === 'ena' ? 'Run、BioProject 或 BioSample 编号' : 'SRA、BioProject 或 BioSample 编号';
  $('sourceHint').textContent = direct ? 'HTTP / HTTPS / FTP' : source === 'ena' ? 'ENA 官方 FASTQ 文件清单' : 'CNCB → NCBI → ENA';
  $('accessions').placeholder = direct ? 'https://example.org/sample.fastq.gz\n也支持 DDBJ 官方文件链接' : '例如 SRR20710520、PRJNA727404 或 SAMN30029129';
  $('inputHelp').textContent = direct ? '不需要预先知道大小。带账号密码的链接暂不支持。' : '每次最多 20 个输入、100 个 Run。项目清单不完整时不会自动下载部分结果。';
});
function renderQueue() {
  if (!files.length) return;
  $('queue').replaceChildren();
  for (const file of files) {
    const row = el('div', undefined, 'file-row'), info = el('div', undefined, 'file-info');
    info.append(el('div', file.name, 'file-name'));
    const meta = el('div', undefined, 'file-meta'); meta.append(el('span', file.provider, 'tag'), document.createTextNode(file.md5 ? '官方 MD5 可核验' : '完成后核对传输状态'));
    info.append(meta); row.append(info, el('span', sizes(file.size), 'file-size')); $('queue').append(row);
  }
  const known = files.reduce((n, f) => n + (f.size || 0), 0), unknown = files.filter(f => f.size == null).length;
  $('queueSummary').textContent = `${files.length} 个文件 · ${unknown === files.length ? '大小未知' : `${sizes(known)}${unknown ? ` + ${unknown} 个大小未知` : ''}`}`;
  $('startButton').disabled = !files.length;
}
$('resolveForm').onsubmit = async event => {
  event.preventDefault(); $('resolveButton').disabled = true; $('resolveButton').textContent = '正在查询…'; $('startButton').disabled = true; notice('正在解析官方元数据，请稍候…');
  try { const result = await api('resolve', { source, text: $('accessions').value }); files = result.files; $('queue').replaceChildren(); if (!files.length) $('queue').append(el('div', '未找到可确认的文件。请检查编号或改用官方直链。', 'empty')); renderQueue(); notice(result.warnings.join('\n') || `已确认 ${files.length} 个文件，请检查目标目录后开始下载。`); }
  catch (error) { notice(error.message, true); }
  finally { $('resolveButton').disabled = false; $('resolveButton').textContent = '查询文件与大小'; }
};
$('defaultDir').onclick = async () => {
  try { if (config?.nativeDirectoryPicker) { const result = await api('directory', {}); if (result.directory) $('directory').value = result.directory; }
    else if (config) $('directory').value = config.directory;
  } catch (error) { notice(error.message, true); }
};
$('startButton').onclick = async () => {
  $('startButton').disabled = true;
  try { await api('start', { ids: files.map(f => f.id), directory: $('directory').value, engine: $('engine').value, connections: Number($('connections').value) }); notice('任务已加入传输列表。'); view('transfers'); await refresh(); }
  catch (error) { notice(error.message, true); } finally { $('startButton').disabled = !files.length; }
};
function renderTasks() {
  const visible = tasks.filter(t => filter === 'all' || (filter === 'active' ? ['running', 'queued'].includes(t.state) : filter === 'failed' ? ['failed', 'cancelled'].includes(t.state) : t.state === filter));
  $('tasks').replaceChildren();
  if (!visible.length) $('tasks').append(el('div', '这里还没有任务。到下载中心查询文件后即可开始。', 'empty'));
  for (const task of visible) {
    const row = el('article', undefined, `task ${task.state}`), head = el('div', undefined, 'task-heading'), info = el('div');
    info.append(el('div', task.name, 'task-title'), el('div', `${task.provider} · ${sizes(task.size)}`, 'file-meta'));
    const actions = el('div', undefined, 'task-actions'); actions.append(el('span', labels[task.state], 'task-state'));
    if (['running', 'queued'].includes(task.state)) { const cancel = el('button', '取消', 'danger'); cancel.onclick = async () => { try { await api('cancel', { id: task.id }); await refresh(); } catch (error) { notice(error.message, true); } }; actions.append(cancel); }
    head.append(info, actions); row.append(head);
    const progress = document.createElement('progress'); progress.max = 100; progress.setAttribute('aria-label', `${task.name} 下载进度`); if (task.progress || task.state !== 'running') progress.value = task.progress; row.append(progress);
    row.append(el('div', task.detail, 'file-meta')); $('tasks').append(row);
  }
  $('taskCount').textContent = tasks.filter(t => ['queued', 'running'].includes(t.state)).length;
}
document.querySelectorAll('.filter').forEach(button => button.onclick = () => { filter = button.dataset.filter; document.querySelectorAll('.filter').forEach(n => n.classList.toggle('active', n === button)); renderTasks(); });
$('clearFinished').onclick = async () => { try { await api('clear', {}); await refresh(); } catch (error) { notice(error.message, true); } };
$('copyLogs').onclick = async () => { try { await navigator.clipboard.writeText($('logText').textContent); notice('日志已复制。'); } catch { notice('无法访问剪贴板，可直接选中日志复制。', true); } };
async function refresh() {
  try { const state = await api('state'); tasks = state.tasks; logs = state.logs; renderTasks(); $('logText').textContent = logs.map(l => `${new Date(l.time).toLocaleTimeString()}  ${l.message}`).join('\n') || '尚无日志。'; $('connectionStatus').textContent = '本机服务已连接 · 无应用代理'; }
  catch { $('connectionStatus').textContent = '本机服务未连接，请检查启动终端'; }
}
try { config = await api('config'); $('directory').value = config.directory; if (config.nativeDirectoryPicker) $('defaultDir').textContent = '选择文件夹'; $('tools').textContent = `本机工具：aria2 ${config.tools.aria2c ? '可用' : '未安装'} · curl ${config.tools.curl ? '可用' : '未安装'}`; if (!config.tools.aria2c) $('engine').value = 'curl'; }
catch (error) { notice(error.message, true); }
await refresh(); setInterval(refresh, 1200);
