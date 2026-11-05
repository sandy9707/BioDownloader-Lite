# BioDownloader Lite

国内直连优先的生信原始数据下载器，当前版本 **0.1.0 原型**。提供浅色本机 Web GUI、编号查询和文件下载，不包含 Mihomo 或应用代理模块。

## 启动

需要 **Node.js 22 或更新版本**，以及可在 PATH 中调用的 **aria2c 或 curl**。没有 npm 运行时依赖，无需执行 npm install。

```sh
git clone https://github.com/sandy9707/BioDownloader-Lite.git
cd BioDownloader-Lite
npm run gui
```

浏览器打开 **http://127.0.0.1:17836**。服务仅监听本机。端口被占用时设置 `LITE_PORT` 后启动；Ctrl+C 停止服务并取消活动下载。

## 已有功能

- SRA Run、BioProject、BioSample 查询；元数据 CNCB → NCBI → ENA 回退。
- SRA 文件优先检查 CNCB 中国镜像，无法确认可用时检查 AWS 公共文件。
- ENA 官方 FASTQ 文件集合、大小和 MD5 查询。
- 匿名 HTTP(S)/FTP 直链，包括官方 DDBJ 文件链接；大小未知也可下载。
- 串行任务队列、进度、取消、筛选及本次会话日志。
- curl / aria2 下载，普通来源可选 1 或 4 连接，CNCB HTTP 固定单连接。
- 独立暂存、拒绝覆盖；有已知大小或提供 MD5 时严格检查。

GUI 的布局沿用 BioDownloader Pro 的下载中心与传输列表习惯，采用淡青绿色调。当前是浏览器界面，不是桌面安装包。

## 命令行

```sh
node src/cli.mjs SAMN30029129 --max-runs 1
node src/cli.mjs PRJNA727404 --max-runs 8
node src/cli.mjs SRR390728 --format fastq
node src/download-cli.mjs 'https://example.org/file' '/absolute/new-output' --engine aria2 --connections 4
npm test
```

下载目标必须不存在。支持 `--size BYTES`、`--md5 HASH` 与 `--timeout-seconds SECONDS`（最多 600 秒）。示例链接仅演示语法。

## 当前边界

- QTrans 官方客户端在独立研究中已验证原生 GSA 公共文件传输；本仓库只有受限目录查询适配器，**GUI 尚未集成 QTrans 下载**。没有证据证明所有 SRR/INSDC 镜像都支持 QTrans，不能将其当作任意 AWS S3 下载器。
- DDBJ 当前支持文件直链，尚无完整编号自动解析。
- 任务保存在服务内存中：刷新页面保留，重启服务不恢复。取消后保留暂存，尚无已验收的暂停/续传。
- 目标目录通过路径输入；暂无原生文件夹选择器或 Electron 窗口。
- 文件发布依赖同文件系统硬链接；不支持时会失败并保留暂存。
- 大小未知且没有来源摘要时，正常完成仅证明传输结束，不等于独立完整性认证。
- 工具不使用应用代理；系统透明隧道仍需用户自行确认。源站访问限制和网络性能因环境而异。

## 自动检查与源码包

GitHub Actions 在 Linux、macOS 上运行离线测试，成功后上传源码压缩包到对应 Actions 运行的 Artifacts。可手动运行工作流。当前不生成 EXE/DMG，也不发布安装包。

源码包保留仓库文件布局，解压后执行 `npm run gui`。开发源码公开可读；本项目尚未指定开源许可证，不能据此推定具有第三方再分发授权。aria2、curl、QTrans 等第三方工具不随源码包分发。
