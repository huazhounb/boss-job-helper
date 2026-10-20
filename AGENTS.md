# 项目规则

- 主交付文件是根目录 `boss-helper.user.js`，不生成第二份不同内容的用户脚本。
- Node.js 工具只用于预览、验证和打包；终端用户安装脚本不需要 Node.js。
- 发布版本使用通用求职模板，不写入任何人的简历、邮箱、Key 或账户记录。
- 作者链接使用 `https://github.com/huazhounb`，沿用 AGPL-3.0-or-later。
- 脚本元数据、CONFIG.VERSION、package.json 和版本记录需一致。
- 保留 `hz_boss_helper_v2_` 前缀及已有明确设置，避免升级覆盖用户话术。
- 文档区分 BOSS 默认招呼语与助手聊天话术，不把点击计数写成送达数。
- 普通列表沟通不需要 AI。未替换的默认话术占位符不能在聊天页直接发送。
- 测试只使用本地 fixture，不向真实 HR 发送任何消息。
- 测试入口只能由预览服务器在 `?test=1` 时注入，不能放入发布脚本。
- 不提交 node_modules、output、dist、浏览器会话、真实日志或用户存储。

## 命令

```sh
npm run check
npm run preview
npm ci
npm run test:browser
```

安装教程在 `docs/INSTALL.md`，开发说明在 `docs/DEVELOPMENT.md`，发布流程在 `docs/PUBLISHING.md`。
