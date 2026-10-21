# LunaTOC — ChatGPT 对话目录

一个面向 ChatGPT 长对话的 Chrome 浏览器扩展：将用户提问整理成可搜索的侧边栏目录，支持定位问题、浏览回答标题，以及在编辑历史问题后主动同步当前对话。

本仓库 **`PyRookie1/luna-toc-sc`** 基于开源项目 [Leo7805/luna-toc](https://github.com/Leo7805/luna-toc) 进行修改与维护。

## 功能

- **可搜索的对话目录**：自动整理 ChatGPT 对话中的用户提问，支持搜索、当前可见问题高亮，以及长对话中的虚拟滚动定位。
- **悬停展开与主动同步**：侧边栏默认收起；鼠标移到 LunaTOC 悬浮按钮即可展开。每次从收起状态展开时会尝试重新获取当前会话数据，使目录跟随最新对话更新。
- **历史编辑分支识别**：编辑历史问题后，若会话接口提供节点关系和 `current_node`，目录会沿当前活动分支重建，避免将旧分支的问题混入当前目录。
- **问题与回答标题导航**：点击目录中的问题文字跳转到对应提问；点击右侧三角按钮单独展开或收起该回答的标题子目录。子目录最多展示两级标题，可点击定位到已渲染的回答标题。
- **目录管理**：支持重命名目录项、标记重要问题，以及悬停预览较长的提问内容。
- **「我的提示词」**：保存、管理常用提示词，支持 Markdown 导入/导出；在 ChatGPT 输入框输入 `#` 或 `//` 可触发提示词补全。
- **侧边栏交互**：支持跳转对话顶部/底部、调整侧边栏宽度、固定/自动隐藏，以及拖动悬浮按钮。
- **外观与本地存储**：适配浅色/深色主题；提示词和部分目录设置保存在浏览器本地存储中。

## 支持范围与已知限制

- **主要支持**：Chrome（Manifest V3）上的 [ChatGPT](https://chatgpt.com/)。清单中同时保留 `chat.openai.com` 匹配规则。
- **尚未支持**：Microsoft Copilot。代码库保留未来平台扩展的占位适配器，但当前扩展不会注入 Copilot 站点，也不提供该平台功能。
- **网页兼容性**：ChatGPT 改动 DOM、滚动容器或会话 API 时，目录同步、回答标题提取及跳转可能需要继续适配。
- **历史分支同步**：优先使用包含节点父子关系的活动分支数据；若仅取得不含分支关系的分页消息，目录同步结果可能不完整或不准确。
- **回答标题**：标题大纲从当前浏览器中已渲染的回答内容提取；未挂载的历史回答可能需要先滚动加载，纯文本回答没有可展开标题。

## 从 GitHub Releases 安装（无需本地构建）

`main` 分支使用 GitHub Actions 自动运行类型检查、测试和构建。类型检查、构建及扩展文件校验通过后，工作流会发布与该次提交对应的 **Pre-release**（预览版本）。

1. 打开 [Releases 下载页](https://github.com/PyRookie1/luna-toc-sc/releases)，找到标题为 **LunaTOC Chrome preview** 的预览版本。
2. 从 Assets 下载 `luna-toc-sc-chrome.zip`，并**解压**到独立文件夹。
3. 打开 Chrome 的 `chrome://extensions/`，开启**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择解压后的文件夹（该目录下应直接包含 `manifest.json`）。
5. 打开或刷新 [ChatGPT](https://chatgpt.com/) 页面。

> 注意：`Code → Download ZIP` 获取的是未构建的源码，不是可安装版本；Chrome 不支持将普通 ZIP 文件直接作为未打包扩展加载。预览版随分支推送自动发布，不代表已完成 Chrome 实机兼容性测试。

每次推送 `main` 分支都会触发 [构建工作流](https://github.com/PyRookie1/luna-toc-sc/actions)。工作流执行 `npm ci`、`npm run typecheck`、`npm test`、`npm run build`，校验 `dist/manifest.json` 所引用的资源后发布 ZIP 和 SHA-256 校验文件；同时在 Actions 中保留 30 天的构建产物。**类型检查、构建或安装包校验失败将阻止发布；现有测试失败会记录在 Actions 日志和 Release 说明中，但不会阻止生成开发预览版。**预览版不等于全部功能通过验证。

## 从源码安装（包含 GitHub ZIP）

本仓库提供的是 **源代码**。从 GitHub 下载的 ZIP 不能直接作为扩展加载，必须先构建。

**环境要求**：Node.js 22.12+（或与 Vite 8 兼容的版本）、npm、Chrome。

1. 在 GitHub 下载本仓库 `main` 分支的 **Code → Download ZIP**，并解压；也可以使用 `git clone`。
2. 在含有 `package.json` 的项目根目录打开终端，执行：

   ```bash
   npm ci
   npm run build
   ```

3. 构建完成后检查 `dist/manifest.json` 是否存在。
4. 打开 Chrome 的 `chrome://extensions/`，启用**开发者模式**。
5. 点击**加载已解压的扩展程序**，选择项目的 **`dist` 文件夹**，然后打开或刷新 ChatGPT 页面。

> 注意：应该加载构建出的 `dist/`，而不是 GitHub 下载的 ZIP，也不是源码根目录。重新构建后，可在扩展管理页点击该扩展的刷新按钮，再刷新 ChatGPT 标签页。

## 如何使用

1. 进入一个 ChatGPT 对话，找到页面中的 LunaTOC 悬浮「目录」按钮，将鼠标移入即可展开侧边栏。
2. **点击问题文字**跳转到对应的提问；**点击右侧三角形**展开或折叠回答中的标题。
3. 点击展开后的标题，定位回答中的对应段落；使用搜索框过滤问题。
4. 编辑某个已回答的历史问题并重新生成回答后，先将侧边栏收起，再次悬停展开以触发当前对话同步。
5. 如需保持侧边栏展开，可使用固定按钮；也可拖动悬浮按钮调整位置。

## 开发与检查

```bash
npm ci
npm run typecheck
npm test
npm run build
```

- `npm run typecheck`：检查 TypeScript 类型。
- `npm test`：运行 Vitest 单元测试。
- `npm run build`：使用 Vite + CRXJS 构建扩展，输出至 `dist/`。
- `npm run dev`：启动本地开发构建环境。

代码主要位于 `src/`；`manifest.json` 是扩展清单源文件，`vite.config.ts` 定义构建配置。

## 隐私与数据处理

项目没有自建对话数据收集服务。目录与对话导航主要在浏览器页面内运行；「我的提示词」、目录重命名等设置存储在浏览器的 `chrome.storage.local` 中。

**主动同步会向 ChatGPT 当前站点的会话接口发送同源请求**，使用浏览器已有的登录会话读取当前对话，因此“所有功能完全离线运行”并不准确。扩展仍受 ChatGPT 服务及接口可用性约束。

## 致谢与许可

感谢 **[Leo7805/luna-toc](https://github.com/Leo7805/luna-toc)** 原开源项目及其贡献者提供 LunaTOC 的基础实现。本仓库在其代码基础上进行了个人定制、功能扩展与交互调整。

项目沿用 **MIT License**。完整许可和原有版权声明请参阅 [LICENSE](LICENSE)。此衍生版本与原作者的官方发布渠道无隶属关系。
