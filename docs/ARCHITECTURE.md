# LunaTOC-SC 当前架构

本文件描述本仓库当前 `main` 目标实现。功能与安装说明以 [README](../README.md) 为准。

## 项目范围

- 产品：LunaTOC-SC，ChatGPT 中文对话目录 Chrome 扩展。
- 浏览器：Chrome，Manifest V3。
- 运行站点：`chatgpt.com` 和 `chat.openai.com`。
- 不包含 Copilot 或其他聊天服务适配。
- 不依赖 ChatGPT 自带的目录按钮，不修改网页的 `window.matchMedia`。

## 执行上下文

`manifest.json` 在 `document_start` 注入两个独立脚本：

1. `src/pageHook/pageHook.iife.ts`：MAIN world，包装同源 `fetch`，观察 SPA 路由和页面标题，采集会话加载与 SSE 更新，并响应主动刷新请求。
2. `src/content.ts`：ISOLATED world，初始化目录、提示词、弹窗和 React Shadow DOM；通过带来源检查的 `window.postMessage` 读取页面钩子发送的数据。

`src/platforms/index.ts` 仅注册 `src/platforms/chatgpt/index.ts`。不同执行上下文使用同一 ChatGPT 平台协议。

## 会话数据与刷新

- `src/pageHook/conversationCapture.ts` 将原始响应克隆后解析，不占用网页本身的响应体。
- `src/pageHook/conversationBackfill.ts` 分页获取历史消息，受 `backfillMaxPages` 上限控制。
- `src/pageHook/conversationRefresh.ts` 在侧边栏展开时获取当前分支。优先尝试具有父节点关系的完整会话映射；回退时要求分页数据完整。
- `src/navigation/state/activeBranch.ts` 按 `current_node` 和 `parent` 解析活动分支；缺少分支信息的扁平消息仅按接口提供的顺序处理。
- `src/navigation/state/conversationStore.ts` 管理缓存和会话状态。主动刷新的快照为权威结果；刷新前已经开始的分页请求不得再恢复旧分支。
- `src/navigation/navigatorController.ts` 协调会话数据、路由变化、目录渲染及主动刷新。

## 目录与导航

- `src/navigation/ui/tocListRenderer.ts` 渲染用户问题目录。
- `src/navigation/jump/promptNavigation.ts` 优先使用明确的消息 ID 跳转；仅对整段对话中唯一、纯文本的提问允许文本回退。
- `src/platforms/chatgpt/virtualSearchAdapter.ts` 从当前已挂载的 DOM 读取消息标识，拒绝含歧义的文本匹配。
- `src/navigation/jump/viewportWalker.ts` 沿 ChatGPT 虚拟滚动容器寻找未挂载的目标消息，支持取消正在进行的查找。
- `src/navigation/jump/outline.ts` 和 `outlineNavigation.ts` 提取并定位已渲染回答的标题，避免使用已脱离 DOM 的缓存元素。

页面结构或接口发生变化时，先更新 ChatGPT 平台适配层，再验证导航行为。

## 我的提示词

- `src/features/myPrompts/promptStore.ts` 持久化提示词，所有返回数据与内部缓存相互隔离，同一扩展上下文内的变更采用串行更新。
- `src/features/myPrompts/promptLibrary.ts` 实现增删改、Markdown 导入导出，并使用存储层原子转换接口。
- `src/features/myPrompts/promptAutocomplete.ts` 在 ChatGPT 的 ProseMirror 输入框上提供 `#`、`//` 补全。
- 原有浏览器存储键继续兼容已有数据，不因产品显示名称变化而更名。

Chrome 存储没有跨扩展上下文的 compare-and-swap 事务，多个标签页同时修改同一组提示词时仍需避免冲突。

## UI 与构建

`src/app/applicationShell.ts` 管理侧边栏生命周期、宽度及主题；`src/reactHost/` 提供隔离 React UI 的 Shadow DOM。侧边栏展开不会伪装网页宽度。

使用 `npm ci`、`npm run typecheck`、`npm test`、`npm run build` 验证；Chrome 加载 `dist/`。GitHub Actions 验证 PR，主分支通过检查后发布可解压安装的预览包。

## 验收边界

自动化单元测试不等于真实 ChatGPT 页面验收。手动验证重点为重复提问、含附件提问、长对话远距跳转、历史编辑分支、窄窗口布局和提示词写入失败。
