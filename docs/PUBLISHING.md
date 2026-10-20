# 上传 GitHub 与制作 Release

账号：[huazhounb](https://github.com/huazhounb)。建议仓库名：`boss-job-helper`。本目录是可上传源文件，文档中的发布流程不表示线上仓库已经创建。

## 方法一：网页上传

1. 登录自己的 GitHub 账号，新建名为 `boss-job-helper` 的仓库。
2. 选择需要的公开性；若要公开分享给测试用户，选择 Public。
3. 在仓库页面选择 **Add file → Upload files**，上传本发布目录内的文件和子目录。仓库根目录应直接看到 `README.md`、`boss-helper.user.js`、`LICENSE`、`docs/` 和 `.github/`。
4. 确认 `.github` 等以点开头的配置目录也已上传，提交更改。

使用 ZIP 时先解压，把内部 `boss-job-helper` 目录的**内容**上传。不要只把 ZIP 当作仓库唯一文件，也不要上传 `node_modules/`、`output/`、`dist/`、浏览器会话或自己的配置数据。

上传后预计仓库地址为 `https://github.com/huazhounb/boss-job-helper`；实际以创建结果为准。README 使用相对路径，改仓库名也不会破坏教程和配图。

## 方法二：Git 上传

先在 GitHub 新建**空仓库**，不要让网站额外生成 README 或许可证。然后在本目录打开终端：

```sh
git init -b main
git add .
git commit -m "Release BOSS job helper v2.2.1"
git remote add origin https://github.com/huazhounb/boss-job-helper.git
git push -u origin main
```

如选择了其他仓库名，请替换远程地址。GitHub 登录按本机 Git 的认证提示完成，不要把访问 Token 写进脚本或文档。

## 本地检查与打包

```sh
npm run check
npm ci
npm run test:browser
```

普通安装不需要依赖；这些命令用于发布前验证。在 Windows PowerShell 7 中制作完整 ZIP：

```powershell
pwsh -File tools/package-release.ps1
```

生成 `dist/boss-job-helper-v2.2.1.zip`，包含源代码、教程、图片、许可证、工具、测试及 GitHub 配置。存在同名压缩包时会停止，不自动覆盖。打包不含依赖或本地运行产物。

## 自动创建 GitHub Release

仓库上传完成、检查通过后，在本机推送与包版本一致的标签：

```sh
git tag v2.2.1
git push origin v2.2.1
```

仓库中的 `release.yml` 会检查版本一致性，归档该标签内容并创建 Release，附件包括 `boss-helper.user.js` 和完整源码 ZIP。工作流需要仓库允许 Actions，并具有内容写入权限；是否执行成功以 GitHub Actions 的实际结果为准。

也可在 GitHub 网页手动创建 Release 并上传这两个文件。不要同时推送标签触发自动工作流又手动创建同名 Release。

## 发布前确认

- 默认求职话术及 AI 人设是模板，不包含任何人的真实简历或邮箱。
- 作者链接为 `https://github.com/huazhounb`，脚本与包版本一致。
- README、安装、配置、常见问题链接和教程图片均可打开。
- 实际运行过本地回归；没有用本地通过冒充真实 BOSS 送达验证。
- 所有公开截图都是审核过的设置或模拟数据，不提交 Key、Cookie 和私聊记录。
