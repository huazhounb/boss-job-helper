# 开发与验证

普通用户只安装根目录 `boss-helper.user.js`。本页仅面向开发者。

## 环境与命令

Node.js 20 或更高版本，浏览器回归需已安装 Microsoft Edge 或 Google Chrome。

```sh
npm ci
npm run check
npm run preview
```

默认预览地址是 <http://127.0.0.1:4180/web/geek/jobs>；`/web/geek/chat` 是聊天模拟。预览服务器只监听 `127.0.0.1`。`BOSS_PREVIEW_PORT` 可修改手工预览端口，自动回归固定使用 4180。

## 浏览器回归

先停止占用 4180 端口的手动预览服务，再运行：

```sh
npm run test:browser
```

Windows 默认使用本机 Edge，其他系统默认使用本机 Chrome。也可明确指定已安装的浏览器：

```sh
npm run test:browser -- --browser msedge
npm run test:browser -- --browser chrome
```

此命令自行启动本地服务、创建独立测试会话，执行 16 项界面及公开模板检查、16 项流程检查，最后关闭测试浏览器并结束服务。若 4180 被占用会报错，不会连接不明服务继续测试。所有点击、聊天、简历与 AI 都是本地模拟。

测试截图和导出样本在 `output/playwright/`。这些产物已忽略；发布教程需要的截图单独放在 `docs/images/`，只提交已审核的模拟内容。

## 文件职责

| 位置 | 职责 |
| --- | --- |
| `boss-helper.user.js` | 唯一用户脚本，包含界面、筛选、状态及运行逻辑 |
| `tools/preview-server.cjs`、`tools/fixture.js`、`preview.html` | 本地模拟环境 |
| `tests/ui-checks.js`、`tests/flow-checks.js` | 通过 Playwright CLI 执行的检查函数 |
| `tools/check-release.cjs` | 语法、版本、文档链接、模板、许可证与常见个人信息检查 |
| `tools/package-release.ps1` | Windows 发布打包，排除依赖、运行产物和本地配置 |
| `.github/workflows/` | Windows/Linux 静态检查及标签 Release 发布 |

`npm run check` 不需要安装开发依赖。它不会请求 BOSS 或外部 AI，也不会自动运行浏览器。CI 当前执行静态发布检查；浏览器回归是显式本地命令，不把静态 CI 通过写成真实网站验证。

## 测试接口与存储

交付脚本不导出内部对象。只有本地预览服务器在 `?test=1` 时向返回的脚本临时注入 `window.__bossTest`，用于检查状态和加快模拟等待。交付代码仍保留正常时间参数。

存储前缀为 `hz_boss_helper_v2_`。任务状态仅在当前页面内存保存，配置及 HR/话术进度保存在当前站点 localStorage。升级不自动覆盖用户原话术；修改存储字段前应考虑已有值。

## 截图与发布

生成并审核回归截图后，复制 `output/playwright/running-panel.png` 为 `docs/images/running-panel.png`。其他截图须检查是否含有个人信息。版本应同步修改脚本元数据、`CONFIG.VERSION`、`package.json`、锁文件和 CHANGELOG。

完整发布步骤见 [上传 GitHub 与制作 Release](PUBLISHING.md)，当前验证结果见 [测试报告](TEST-REPORT.md)。
