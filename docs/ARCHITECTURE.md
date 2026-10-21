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

- `src/navigation/ui/tocListRenderer.ts` 渲染用户问题目录；行内只显示序号和提问文字，距高亮行左边缘约6px；超长提问由 CSS `text-overflow: ellipsis` 省略显示（DOM 内保留完整文字），不创建可点击三点按钮或展开三角。目录项右键菜单提供「收藏」「复制」「添加」，侧边栏关闭时通过 `promptContextMenuController.close()` 同步关闭 React Portal 菜单。收藏复用 `src/features/conversationPrompts/promptMark.ts` 的会话存储与状态标记，不再显示行内旗子；复制使用 `src/features/conversationPrompts/copyPrompt.ts` 的剪贴板 API 及回退。
- `src/navigation/jump/promptNavigation.ts` 优先使用明确的消息 ID 跳转；仅对整段对话中唯一、纯文本的提问允许文本回退。
- `src/platforms/chatgpt/virtualSearchAdapter.ts` 从当前已挂载的 DOM 读取消息标识，拒绝含歧义的文本匹配。
- `src/navigation/jump/viewportWalker.ts` 沿 ChatGPT 虚拟滚动容器寻找未挂载的目标消息，支持取消正在进行的查找。
- `src/navigation/jump/outline.ts` 和 `outlineNavigation.ts` 提取并定位已渲染回答的标题，避免使用已脱离 DOM 的缓存元素。点击目录项时仍执行精确跳转，并切换该项回答标题的展开状态：首次展开、再次点击收起、再点击重新展开；对于虚拟化回答，重复点击可取消尚未完成的展开请求。

页面结构或接口发生变化时，先更新 ChatGPT 平台适配层，再验证导航行为。

## 我的提示词

- `src/features/myPrompts/promptStore.ts` 持久化提示词，所有返回数据与内部缓存相互隔离，同一扩展上下文内的变更采用串行更新。
- `src/features/myPrompts/promptLibrary.ts` 实现增删改、Markdown 导入导出，并使用存储层原子转换接口。
- `src/features/myPrompts/promptAutocomplete.ts` 在 ChatGPT 的 ProseMirror 输入框上提供 `#`、`//` 补全。
- 原有浏览器存储键继续兼容已有数据，不因产品显示名称变化而更名。

Chrome 存储没有跨扩展上下文的 compare-and-swap 事务，多个标签页同时修改同一组提示词时仍需避免冲突。

## UI 与构建

`src/app/applicationShell.ts` 管理侧边栏生命周期、宽度及主题；`src/reactHost/` 提供隔离 React UI 的 Shadow DOM。`src/features/SidebarToggleButton.ts` 创建视口右缘宽 6px、贯穿视口高度的完全透明鼠标触发区，不含背景、悬停色或可见描边。`src/features/sidebarVisibility.ts` 协调侧边栏与触发条互斥显示，自动收起采用 60ms 缓冲、100ms 动画并保留固定与扩展弹层悬停保护。 `src/features/sidebar/sidebarPreferences.ts` 在 `chrome.storage.local` 中维护布局、背景配色及触发区颜色开关，设置页与内容脚本监听同一个变更事件。默认背景使用明确的 `transparent` 变量覆盖旧蓝色底板，同时禁用默认背景模糊；非默认色仍按深浅主题混色。`src/features/sidebar/chatGptSideBySide.ts` 在并排模式下识别 ChatGPT 的实际聊天主列并预留侧边栏宽度，监听宽度、窗口及 SPA 结构变化；空间不足或无法安全识别时回退浮层模式，不修改 `window.matchMedia` 或页面 body。三个导航按钮由 `src/features/sidebar/jumpToEdgeControls.ts` 创建，由 `src/features/sidebar/jumpControlsPosition.ts` 负责工具区域纵向拖动、键盘上下调节、尺寸边界和会话存储；侧边栏展开时不会强制弹出按钮组，重新进入工具区域后才显示；鼠标移出按钮组后仅按钮及底板淡出，保留右缘2px宽且高度恰好覆盖三个按钮及间距的半透明深色触发线（暗/亮主题分别适配）；重新进入保留的透明命中区域后重新显示，隐藏时不可直接点击或通过 Tab 到达。目录滚动条和工具条贴齐浏览器右边缘，不再渲染独立的三点菜单按钮或展开三角形。收藏操作保留原持久化逻辑，界面不显示旗子。侧边栏展开不会伪装网页宽度，并排和浮层模式的固定/隐藏默认值不同；用户手动固定状态在相同模式的当前标签页中保留。

使用 `npm ci`、`npm run typecheck`、`npm test`、`npm run build` 验证；Chrome 加载 `dist/`。GitHub Actions 验证 PR，主分支通过检查后发布可解压安装的预览包。

## 验收边界

自动化单元测试不等于真实 ChatGPT 页面验收。手动验证重点为重复提问、含附件提问、长对话远距跳转、历史编辑分支、窄窗口布局和提示词写入失败。
