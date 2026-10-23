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
- `src/navigation/navigatorController.ts` 协调会话数据、路由变化、目录渲染及主动刷新；权威刷新失败或 15 秒超时会将缓存标为未验证，迟到的分页数据不得重置验证状态；成功删除则清空当前视图。
- `src/navigation/jump/navigationSnapshotStore.ts` 限制标签页内快照数量，提供逐会话删除和全量重置；会话切换不保留无界的原始分页消息集合。
- `src/pageHook/conversationLifecycle.ts` 在页面初始化时通过 ChatGPT 同源会话接口识别登录账号，并识别成功的 DELETE 或 `is_visible=false` 删除操作；归档不作为删除。单一接口 GET 返回 404/410 可能是 API 不兼容或权限问题，不作为本地删除证据。
- `src/navigation/lifecycle/conversationLifecycle.ts` 处理账号识别与明确成功的删除通知；`src/navigation/lifecycle/conversationOwner.ts` 保存已验证登录账号身份。不会依赖不确定的服务端存在性查询破坏本地别名，不启用后台轮询。

## 目录与导航

- `src/navigation/ui/tocListRenderer.ts` 渲染用户问题目录；行内只显示序号和提问文字，距高亮行左边缘约6px；超长提问由 CSS `text-overflow: ellipsis` 省略显示（DOM 内保留完整文字），不创建可点击三点按钮或展开三角。目录项右键菜单默认按「复制文字」「添加tips」「编辑文字」排列；当前回答标题目录已展开且包含标题时始终附加「收起目录」；如果同时超出侧边栏无遮挡可视范围，则将「回到顶部」放在它之前、「回到底部」放在它之后，已有别名时再附加「恢复原文」；已彻底移除收藏功能。添加始终打开原有提示词编辑保存流程；菜单显示时以当前行文本的顶部、展开标题列表的底部和 `#navigator-list` 的实际可视范围（考虑毛玻璃顶栏遮挡）作判断；全部可见则隐藏两项；菜单选择上下边界操作时再次确认仍有遮挡；选择「收起目录」则按消息身份和当前行 DOM 双重校验，再由 `outline.ts` 收起指定目录而不跳转聊天正文，保留标题缓存便于后续重新展开；如果收起前该问题目录被顶部毛玻璃栏或列表上边界遮挡，收起后将其滚动到侧边栏可视区域首位，已可见的目录不额外滚动。回到顶部／底部只对 `#navigator-list` 滚动：顶部以目录项行首为锚点，读取 `.navigator-topbar` 实际底边避免毛玻璃栏遮挡；底部优先使后续第一条可见目录项完整进入视口，没有下一条则对齐展开标题列表末项。选择菜单动作时重新检查仍处于展开状态，避免重绘、收起或切换会话造成错误滚动；完全不改变 ChatGPT 正文的位置。侧边栏关闭时通过 `promptContextMenuController.close()` 同步关闭 React Portal 菜单；复制仍使用 `src/features/conversationPrompts/copyPrompt.ts` 的剪贴板 API 及回退。
- `src/features/conversationPrompts/tocAliasStore.ts` 将自定义目录标题按永久会话 ID、消息 ID 写入 Chrome 本地存储；写入和删除在单扩展上下文内排队，确认删除会立即作废待写任务。仅覆盖显示，导航和复制始终基于原始消息。`src/navigation/ui/tocListRenderer.ts` 在被右键选中的目录行原位装载多行 textarea，通过 scrollHeight 和 ResizeObserver 随文字换行、侧边栏宽度自动增高以展示完整内容，并在目录刷新时保留草稿；支持 Enter 保存、Shift+Enter 换行、Esc 取消、失焦保存、失败重试及路由切换清理，不再使用独立重命名弹窗。目录搜索同时覆盖原文和别名，恢复原文时移除本地覆盖。
- `src/navigation/jump/promptNavigation.ts` 优先使用明确的消息 ID 跳转；仅对整段对话中唯一、纯文本的提问允许文本回退。
- `src/platforms/chatgpt/virtualSearchAdapter.ts` 从当前已挂载的 DOM 读取消息标识，拒绝含歧义的文本匹配。
- `src/navigation/jump/viewportWalker.ts` 沿 ChatGPT 虚拟滚动容器寻找未挂载的目标消息，支持取消正在进行的查找。
- `src/navigation/jump/headingExtractor.ts` 选取实际出现的前三种标题级别（以 HTML 标题序号从浅到深排序），跳过不存在的级别并压缩为三级展示；`src/navigation/jump/outline.ts` 与 `outlineNavigation.ts` 渲染与定位已挂载回答的标题，避免使用已脱离 DOM 的缓存元素。点击目录项时仍执行精确跳转，并切换该项回答标题的展开状态：首次展开、再次点击收起、再点击重新展开；对于虚拟化回答，重复点击可取消尚未完成的展开请求。

页面结构或接口发生变化时，先更新 ChatGPT 平台适配层，再验证导航行为。

## 我的提示词

- `src/features/myPrompts/promptStore.ts` 持久化提示词，所有返回数据与内部缓存相互隔离，同一扩展上下文内的变更采用串行更新。
- `src/features/myPrompts/promptLibrary.ts` 实现增删改、Markdown 导入导出，并使用存储层原子转换接口。
- `src/features/myPrompts/promptAutocomplete.ts` 在 ChatGPT 的 ProseMirror 输入框上提供 `#`、`//` 补全。
- `src/features/myPrompts/promptUsageStore.ts` 在启动时按现存提示词 ID 清理孤立使用统计，并在写入失败时回滚内存状态。
- 原有浏览器存储键继续兼容已有数据，不因产品显示名称变化而更名。

Chrome 存储没有跨扩展上下文的 compare-and-swap 事务，多个标签页同时修改同一组提示词时仍需避免冲突。

## UI 与构建

`src/app/applicationShell.ts` 管理侧边栏生命周期、宽度及主题；`src/reactHost/` 提供隔离 React UI 的 Shadow DOM。`src/features/SidebarToggleButton.ts` 创建视口右缘宽 6px、贯穿视口高度的完全透明鼠标触发区，不含背景、悬停色或可见描边。`src/features/sidebarVisibility.ts` 协调侧边栏与触发条互斥显示，自动收起采用 60ms 缓冲、100ms 动画并保留固定与扩展弹层悬停保护。 `src/features/sidebar/sidebarPreferences.ts` 在 `chrome.storage.local` 中维护布局、背景配色及触发区颜色开关，设置页与内容脚本监听同一个变更事件。默认背景沿用原有浅蓝/深蓝半透明主题底色与 12px 背景模糊，不再设置透明覆盖；非默认色仍按深浅主题混色。`src/features/sidebar/chatGptSideBySide.ts` 在并排模式下识别 ChatGPT 的实际聊天主列并预留侧边栏宽度，监听宽度、窗口及 SPA 结构变化；空间不足或无法安全识别时回退浮层模式，不修改 `window.matchMedia` 或页面 body。三个导航按钮由 `src/features/sidebar/jumpToEdgeControls.ts` 创建，由 `src/features/sidebar/jumpControlsPosition.ts` 计算鼠标高度对应的工具组位置并在顶部和底部边界内裁切；`src/features/sidebarVisibility.ts` 第一次指针进入视口最右缘仅展开侧边栏；需先离开右缘再重新进入且持续停留 50ms 后，按钮才在指针高度出现。离开边缘、关闭侧边栏或切换状态会取消待触发计时；鼠标进入按钮组后保持位置稳定供点击，离开右缘或按钮组后等待 400ms 才隐藏，指针返回取消计时；只有按钮已出现且鼠标离开整个侧边栏时，侧边栏自动收起也采用相同 400ms 宽限，普通场景仍维持 60ms。旧版拖动位置的会话存储在初始化时删除。隐藏时按钮不可点击或通过 Tab 到达；键盘用户在打开的侧边栏内可按 `Alt+Shift+J` 显示按钮并聚焦首个按钮。目录列表仍保留 `overflow-y: auto` 滚动，但通过 `scrollbar-width: none` 和 `::-webkit-scrollbar` 隐藏可见轨道；工具条仍贴齐浏览器右边缘。不再渲染独立的三点菜单按钮或展开三角形。侧边栏展开不会伪装网页宽度，并排和浮层模式的固定/隐藏默认值不同；用户手动固定状态在相同模式的当前标签页中保留。

使用 `npm ci`、`npm run typecheck`、`npm test`、`npm run build` 验证；Chrome 加载 `dist/`。GitHub Actions 对 PR 与 main 推送只执行 CI（类型检查、测试、构建、资源和 ZIP 校验），不会自动发布；只有在 main 上手动确认后才执行独立发布工作流。CI 权限只读，发布写权限限制在单个发布作业；旧 Releases、Git 标签和分支不自动删除。参见 [发布与恢复说明](RELEASE_PROCESS.md)。

## 验收边界

自动化单元测试不等于真实 ChatGPT 页面验收。手动验证重点为重复提问、含附件提问、长对话远距跳转、历史编辑分支、窄窗口布局和提示词写入失败。

## 工具栏兼容性兜底

`src/features/contractAlert/toolbarMonitor.ts` 在 ISOLATED world 常驻，复用现有接口 mismatch 记录，并以页面钩子 PING/PONG 和已渲染对话的关键 DOM 标记二次采样作保守兜底；不发额外网络请求。`src/background.ts` 在 MV3 service worker 中按标签页写入 `chrome.storage.session`，设置浏览器 action `!` 标记，`src/components/popup/PopupApp.tsx` 显示升级指引。整页重新加载清除旧标记；其他标签页不受影响。开发者模态诊断开关仍独立，用户工具栏告警默认启用。检测并不保证覆盖任意未知的未来结构变化。
