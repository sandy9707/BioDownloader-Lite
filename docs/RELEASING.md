# Lite 发布约定

## 完整安装包发布

1. 更新package.json与lock版本，提交推送；运行 `Build Lite installers`。
2. 必须四平台全部成功，含测试与桌面渲染；固定同一提交，禁止混合旧包。
3. 用Python3.11+执行 `python3 scripts/publish-release.py --run RUN_ID --tag vVERSION --directory NEW_STAGING --notes NOTES.md`。
4. 脚本检查成功工作流、版本、七份非空安装资产，产生manifest/SHA256SUMS，创建GitHub预发布Release及对应Tag。拒绝已存在Release，不覆盖发行资产。正式稳定发布需要另行验收决定。
5. Release是用户入口；Actions Artifacts只是短期构建中间产物，不把两者混称。

## 百度网盘自动同步

完整安装包（大包）镜像到独立 `/apps/baidupcs/BioDownloader-Lite/vVERSION/`。不影响Pro、不删除历史、不覆盖同名文件。热更新-only Release不上传；当前没有ASAR热更新机制。预览版完整安装包也镜像，未来若只镜像稳定版应显式修改策略。

本机有登录态的BaiduPCS-Go与gh负责，凭据不进GitHub Secrets/源码。定时运行：

```sh
python3 scripts/sync-baidu.py --state /absolute/private/mirror-state
```

新Release自动发现；发布manifest冻结七份清单，下载后检查大小/发行摘要；上传使用有效参数 `-p 1 -l 1`，最终按逐文件精确字节核验才记录verified。同名不一致直接失败。每条命令有超时，sync.lock防重入；进程异常被杀后须核对PID再处理遗留锁，不能盲删。使用macOS LaunchAgent每30分钟补跑，机器关机/睡眠时不保证立即上传，下次唤醒运行；不是GitHub云端持有百度登录态。

## 继承2.x经验

同提交构建、全平台通过后发布、非空/精确字节校验、发行不可覆盖、网盘侧核验和有界补跑。不会迁移旧脚本中的整目录删除、关闭TLS校验或固定代理；不触碰2.x生产清单、官网和网盘目录。没有签名/公证或完整人工安装证据时必须在Release说明中写明。
