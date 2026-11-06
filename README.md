# BioDownloader Lite

**[安装包下载 / GitHub Releases](https://github.com/sandy9707/BioDownloader-Lite/releases)** · [发布与网盘自动镜像约定](docs/RELEASING.md)

**[百度网盘完整包镜像](https://pan.baidu.com/s/1xqOGSrh_ws6EEF-85TNgqw?pwd=2fed)**（提取码 `2fed`，按版本分目录；v0.1.0七份安装包已逐文件核验字节数）。

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

## 桌面安装包（预览）

独立Electron桌面窗口已接入，使用原生文件夹选择器与本机随机端口。Windows NSIS支持选择安装目录、快捷方式，卸载保留用户数据；macOS输出DMG/ZIP，Linux输出AppImage/DEB。应用标识与Pro分离，不嵌入Mihomo，不接入Pro更新/计费服务。活动任务退出前提示，退出取消本轮子进程；未实现重启续传，不承诺断点恢复。

开发启动 `npm ci && npm start`；打包 `npm run dist`。通过GitHub Actions的 **Build Lite installers** 手动构建，产物在Artifacts。当前未签名/公证，是早期预览包；构建与桌面渲染冒烟不等于所有平台已人工安装验收。安装包包含Electron运行时，用户不用额外安装Node；aria2/QTrans尚未随包分发，默认回退系统curl（Windows10/11、macOS通常自带），设置会显示工具可用状态。

吸收2.x的独立提交构建、不可覆盖目标、完整文件验收、原生目录选择、退出清理与卸载保留原则；代理/账号业务不迁入。发布包不复用Pro Tag/清单，版本包不能覆盖已发行资产。

源码工作流在 Linux、macOS 上运行离线测试，成功后上传源码压缩包到对应 Actions 运行的 Artifacts。安装包由独立工作流生成；推送版本Tag或手动勾选publish时，四平台全部通过后自动创建预发布Release（七份安装包、manifest、SHA256SUMS）。已发资产不覆盖。完整包Release由本机定时镜像至百度网盘独立版本目录，只有网盘侧精确字节核验通过才算完成；机器离线会延迟同步。

源码包保留仓库文件布局，解压后执行 `npm run gui`。开发源码公开可读；本项目尚未指定开源许可证，不能据此推定具有第三方再分发授权。aria2、curl、QTrans 等第三方工具不随源码包分发。
