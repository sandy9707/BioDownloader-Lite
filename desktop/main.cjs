const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let window, service, quitting = false;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    await session.defaultSession.setProxy({ mode: 'direct' });
    const { createGuiServer } = await import(pathToFileURL(path.join(__dirname, '../gui/server.mjs')).href);
    service = createGuiServer({ chooseDirectory: async () => {
      const result = await dialog.showOpenDialog(window, { title: '选择下载目录', properties: ['openDirectory', 'createDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    }, defaultDirectory: path.join(app.getPath('downloads'), 'BioDownloader-Lite') });
    await new Promise((resolve, reject) => { service.server.once('error', reject); service.server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${service.server.address().port}`;
    window = new BrowserWindow({ width: 1180, height: 820, minWidth: 760, minHeight: 600,
      title: 'BioDownloader Lite', backgroundColor: '#f4f7f8', autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    window.on('close', event => {
      if (quitting) return;
      const active = service.tasks.filter(t => ['running', 'queued'].includes(t.state)).length;
      if (active && dialog.showMessageBoxSync(window, { type: 'question', buttons: ['继续下载', '取消任务并退出'], defaultId: 0, cancelId: 0,
        title: '还有下载任务', message: `还有 ${active} 个下载任务。退出会取消传输并保留暂存文件。`, detail: '当前版本重启后不恢复队列；重新下载不会覆盖已有完整文件。' }) === 0) event.preventDefault();
    });
    await window.loadURL(origin);
    if (process.argv.includes('--smoke-test')) {
      const result = await window.webContents.executeJavaScript('({title:document.title,body:Boolean(document.querySelector("#resolveForm")),token:Boolean(document.querySelector("meta[name=lite-token]"))})');
      if (result.title !== 'BioDownloader Lite' || !result.body || !result.token) throw new Error('Desktop render contract failed');
      console.log('LITE_DESKTOP_SMOKE_OK'); app.quit();
    }
  }).catch(error => { dialog.showErrorBox('BioDownloader Lite 启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (quitting || !service) return;
    event.preventDefault(); quitting = true;
    service.stop();
    const start = Date.now();
    const wait = setInterval(() => {
      if (!service.tasks.some(t => t.state === 'running') || Date.now() - start > 7000) {
        clearInterval(wait); app.quit();
      }
    }, 100);
  });
}
