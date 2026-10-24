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
- `src/pageHook/conversationRefresh.ts` 在侧边栏展开时获取当前分支。优先尝试具有父节点关系的完整会话映射；回退时分页不仅必须完整，还必须提供可逐节点核实的父链。页面钩子验证成功后才标记内部 `activeBranchVerified` 字段。
- `src/navigation/state/activeBranch.ts` 按 `current_node` 和 `parent` / `parent_id` 解析活动分支；缺少可证明父链的扁平消息不再作为权威快照，保留原目录并标记未验证。
- `src/navigation/state/conversationStore.ts` 管理缓存和会话状态。主动刷新已核验的快照为权威结果；新的非权威分页也不能恢复旧编辑分支，但独立观察到的用户新消息可加入当前目录。
- `src/navigation/navigatorController.ts` 协调会话数据、路由变化、目录渲染及主动刷新；权威刷新失败或 15 秒超时会将缓存标为未验证，迟到的分页数据不得重置验证状态；成功删除则清空当前视图。
- `src/navigation/jump/navigationSnapshotStore.ts` 限制标签页内快照数量，提供逐会话删除和全量重置；会话切换不保留无界的原始分页消息集合。
- `src/pageHook/conversationLifecycle.ts` 在页面初始化时通过 ChatGPT 同源会话接口识别登录账号，并观察成功的 DELETE 或 `is_visible=false` 页面操作；但 MAIN world 发出的删除通知属于不可信的页面通道，不能授权扩展删除本地数据。归档不作为删除。单一接口 GET 返回 404/410 可能是 API 不兼容或权限问题，也不作为本地删除证据。
- `src/navigation/lifecycle/conversationLifecycle.ts` 处理账号识别，但忽略不可信 `TOC_CONVERSATION_DELETED` 页面消息，避免伪造的成功删除通知清理持久目录别名或导航缓存；`src/navigation/lifecycle/conversationOwner.ts` 保存页面识别到的账号身份。此取舍意味着删除 ChatGPT 会话后本地别名可能残留。不启用后台轮询。

## 目录与导航

- `src/navigation/ui/tocListRenderer.ts` 渲染用户问题目录；行内只显示序号和提问文字，距高亮行左边缘约6px；超长提问由 CSS `text-overflow: ellipsis` 省略显示（DOM 内保留完整文字），不创建可点击三点按钮或展开三角。目录项右键菜单默认按「复制文字」「添加tips」「编辑文字」排列；当前回答标题目录已展开且包含标题时始终附加「收起目录」；如果同时超出侧边栏无遮挡可视范围，则将「回到顶部」放在它之前、「回到底部」放在它之后，已有别名时再附加「恢复原文」；已彻底移除收藏功能。添加始终打开原有提示词编辑保存流程；菜单显示时以当前行文本的顶部、展开标题列表的底部和 `#navigator-list` 的实际可视范围（考虑毛玻璃顶栏遮挡）作判断；全部可见则隐藏两项；菜单选择上下边界操作时再次确认仍有遮挡；选择「收起目录」则按消息身份和当前行 DOM 双重校验，再由 `outline.ts` 收起指定目录而不跳转聊天正文，保留标题缓存便于后续重新展开；如果收起前该问题目录被顶部毛玻璃栏或列表上边界遮挡，收起后将其滚动到侧边栏可视区域首位，已可见的目录不额外滚动。回到顶部／底部只对 `#navigator-list` 滚动：顶部以目录项行首为锚点，读取 `.navigator-topbar` 实际底边避免毛玻璃栏遮挡；底部优先使后续第一条可见目录项完整进入视口，没有下一条则对齐展开标题列表末项。选择菜单动作时重新检查仍处于展开状态，避免重绘、收起或切换会话造成错误滚动；完全不改变 ChatGPT 正文的位置。侧边栏关闭时通过 `promptContextMenuController.close()` 同步关闭 React Portal 菜单；复制仍使用 `src/features/conversationPrompts/copyPrompt.ts` 的剪贴板 API 及回退。
- `src/features/conversationPrompts/tocAliasStore.ts` 将自定义目录标题按已验证账号 ID 与永久会话 ID 关联，记录必须携带非空 `ownerId`；未绑定账号的旧别名由后台共享队列清理。目录别名写入和明确成功的会话删除通过 `chrome.runtime.sendMessage` 发送给 `src/background.ts`，由 `tocAliasWriteCoordinator.ts` 按队列处理。后台从持久记录按消息 ID 更新别名，不再执行跨标签页旧值冲突比较。成功删除先保存持久删除标记再删除别名，即使旧标签页或后台工作线程重启也不能重建旧会话。仅覆盖显示，导航和复制始终基于原始消息。`src/navigation/ui/tocListRenderer.ts` 在被右键选中的目录行原位装载多行 textarea，通过 scrollHeight 和 ResizeObserver 随文字换行、侧边栏宽度自动增高以展示完整内容，并在目录刷新时保留草稿；支持 Enter 保存、Shift+Enter 换行、Esc 取消、失焦保存、失败重试及路由切换清理，不再使用独立重命名弹窗。目录搜索同时覆盖原文和别名，恢复原文时移除本地覆盖。
- `src/navigation/jump/promptNavigation.ts` 优先使用明确的消息 ID 跳转；仅对整段对话中唯一、纯文本的提问允许文本回退。
- `src/platforms/chatgpt/virtualSearchAdapter.ts` 从当前已挂载的 DOM 读取消息标识，拒绝含歧义的文本匹配。
- `src/navigation/jump/viewportWalker.ts` 沿 ChatGPT 虚拟滚动容器寻找未挂载的目标消息，支持取消正在进行的查找。
- `src/navigation/jump/headingExtractor.ts` 选取实际出现的前三种标题级别（以 HTML 标题序号从浅到深排序），跳过不存在的级别并压缩为三级展示；`src/navigation/jump/outline.ts` 与 `outlineNavigation.ts` 渲染与定位已挂载回答的标题，避免使用已脱离 DOM 的缓存元素。点击目录项时仍执行精确跳转，并切换该项回答标题的展开状态：首次展开、再次点击收起、再点击重新展开；对于虚拟化回答，重复点击可取消尚未完成的展开请求。

页面结构或接口发生变化时，先更新 ChatGPT 平台适配层，再验证导航行为。

## 我的提示词

- `src/features/myPrompts/promptStore.ts` 将提示词按已验证的 ChatGPT 账号 ID 隔离，同一账号下的不同对话共享同一列表；`getAll()` 只返回当前账号的记录，清空操作只清空当前账号及其使用统计。写入经 `chrome.runtime.sendMessage` 发送到 `src/background.ts`，由 `src/features/myPrompts/promptWriteCoordinator.ts` 在后台按序读取、验证并合并当前账号数据，保留其他账号的提示词。旧存储键名不变，但记录新增必需的 `ownerId`；未绑定账号的旧提示词及孤立使用统计会被清理。
- `src/features/myPrompts/promptLibrary.ts` 实现增删改、Markdown 导入导出，并使用存储层原子转换接口。
- `src/features/myPrompts/promptAutocomplete.ts` 在 ChatGPT 的 ProseMirror 输入框上提供 `#`、`//` 补全。
- `src/features/myPrompts/promptUsageStore.ts` 在启动时按现存提示词 ID 清理孤立使用统计，并在写入失败时回滚内存状态。
- 提示词存储键名保留，但记录格式新增必需的 `ownerId`；无归属的旧提示词不自动认领。JSON 备份格式升级到 v2，提示词和目录别名必须绑定账号。主题和侧边栏偏好继续包含在备份中，目前仍是浏览器级全局设置。

提示词、目录别名、使用统计、主题和侧边栏设置均通过 `src/background.ts` 的共享 `SerialWriteQueue` 写入；备份导出在同一队列读取一致快照，恢复也在队列内执行容量预检、写入核对和补偿回滚。因此新版扩展自己的受管写入不会与备份恢复交错。Chrome storage 仍不提供跨上下文原子事务，旧版本脚本或未来新增的直接写入路径可能绕过队列；详见 [本地备份与恢复](LOCAL_BACKUP.md)。

## UI 与构建

`src/app/applicationShell.ts` 管理侧边栏生命周期、宽度及主题；`src/reactHost/` 提供隔离 React UI 的 Shadow DOM。`src/features/SidebarToggleButton.ts` 创建视口右缘宽 6px、贯穿视口高度的完全透明鼠标触发区，不含背景、悬停色或可见描边。`src/features/sidebarVisibility.ts` 协调侧边栏与触发条互斥显示，自动收起采用 60ms 缓冲、100ms 动画并保留固定与扩展弹层悬停保护。 `src/features/sidebar/sidebarPreferences.ts` 在 `chrome.storage.local` 中维护布局、背景配色及触发区颜色开关，设置页与内容脚本监听同一个变更事件。默认背景沿用原有浅蓝/深蓝半透明主题底色与 12px 背景模糊，不再设置透明覆盖；非默认色仍按深浅主题混色。`src/features/sidebar/chatGptSideBySide.ts` 在并排模式下识别 ChatGPT 的实际聊天主列并预留侧边栏宽度，监听宽度、窗口及 SPA 结构变化；空间不足或无法安全识别时回退浮层模式，不修改 `window.matchMedia` 或页面 body。三个导航按钮由 `src/features/sidebar/jumpToEdgeControls.ts` 创建，由 `src/features/sidebar/jumpControlsPosition.ts` 计算鼠标高度对应的工具组位置并在顶部和底部边界内裁切；`src/features/sidebarVisibility.ts` 第一次指针进入视口最右缘仅展开侧边栏；需先离开右缘再重新进入且持续停留 50ms 后，按钮才在指针高度出现。离开边缘、关闭侧边栏或切换状态会取消待触发计时；鼠标进入按钮组后保持位置稳定供点击，离开右缘或按钮组后等待 400ms 才隐藏，指针返回取消计时；只有按钮已出现且鼠标离开整个侧边栏时，侧边栏自动收起也采用相同 400ms 宽限，普通场景仍维持 60ms。旧版拖动位置的会话存储在初始化时删除。隐藏时按钮不可点击或通过 Tab 到达；键盘用户在打开的侧边栏内可按 `Alt+Shift+J` 显示按钮并聚焦首个按钮。目录列表仍保留 `overflow-y: auto` 滚动，但通过 `scrollbar-width: none` 和 `::-webkit-scrollbar` 隐藏可见轨道；工具条仍贴齐浏览器右边缘。不再渲染独立的三点菜单按钮或展开三角形。侧边栏展开不会伪装网页宽度，并排和浮层模式的固定/隐藏默认值不同；用户手动固定状态在相同模式的当前标签页中保留。

使用 `npm ci`、`npm run typecheck`、`npm test`、`npm run build` 验证；Chrome 加载 `dist/`。GitHub Actions 对 PR 与 main 推送只执行 CI（类型检查、测试、构建、资源和 ZIP 校验），不会自动发布；只有在 main 上手动确认后才执行独立发布工作流。CI 权限只读，发布写权限限制在单个发布作业；旧 Releases、Git 标签和分支不自动删除。参见 [发布与恢复说明](RELEASE_PROCESS.md)。

## 验收边界

自动化单元测试不等于真实 ChatGPT 页面验收。手动验证重点为重复提问、含附件提问、长对话远距跳转、历史编辑分支、窄窗口布局和提示词写入失败。

## 工具栏兼容性兜底

`src/features/contractAlert/toolbarMonitor.ts` 在 ISOLATED world 常驻，复用现有接口 mismatch 记录，并以页面钩子 PING/PONG 和已渲染对话的关键 DOM 标记二次采样作保守兜底；不发额外网络请求。`src/background.ts` 在 MV3 service worker 中按标签页写入 `chrome.storage.session`，设置浏览器 action `!` 标记，`src/components/popup/PopupApp.tsx` 显示升级指引。整页重新加载清除旧标记；SPA 路由变化也会先清除旧异常并重新采样。内容脚本仅在真实恢复（页面钩子 PONG、接口契约正向匹配、连续两次已渲染 DOM 标记正常）或路由切换后发送健康状态；单纯关闭开发者弹窗不会取消工具栏告警。后台在同一标签页串行写入带修订号的异常/健康状态，并保留健康状态屏障，避免同文档旧消息使“!”再次出现；其他标签页不受影响。开发者模态诊断开关仍独立，用户工具栏告警默认启用。检测并不保证覆盖任意未知的未来结构变化。

## 本地数据备份与恢复

`src/features/backup/localBackup.ts` 提供本地 JSON v1 备份、字段校验、合并/覆盖恢复与失败回滚；只读取明确许可的本地键（提示词、使用统计、目录别名、主题、侧边栏偏好），不导出 ChatGPT 对话或凭证。`src/components/options/LocalBackupSettings.tsx` 将选择文件、内容预览和二次确认放在扩展设置页；原 Markdown 提示词导入导出保持不变。普通目录编辑已经通过后台串行协调；备份恢复仍属于单独的批量本地写入，并非同一事务。显式恢复旧会话别名会移除其删除标记；详见 [本地备份与恢复](LOCAL_BACKUP.md)。

## 阶段十：统一本地写入与容量保护

`src/features/storage/serialWriteQueue.ts` 提供 rejection-safe 的串行队列；后台将提示词、目录别名、使用统计、主题和侧边栏偏好以及批量备份恢复接入同一实例。使用统计由后台从最新存储值执行递增/删除/清理，避免每个标签页用旧缓存覆盖另一个标签页的计数。备份恢复先用 `getBytesInUse` 计算受影响数据和待写入值的预计占用，超过 `storage.local` 容量时在任何写入之前拒绝。此协调只约束当前版本遵循协议的扩展写入，不构成 Chrome storage 的通用事务。

## 阶段九：自动化浏览器验收与供应链审查

浏览器端到端测试使用 `test/browser/extension.test.mjs`，通过 Playwright 启动带独立配置文件的 Chromium 并加载构建后的 `dist/`。对 `chatgpt.com` 的页面和会话 API 请求全部使用固定模拟数据处理，其他外部 HTTP 请求被阻止；覆盖目录、搜索、侧边栏、键盘、布局、SPA 路由、异常请求和刷新。自动化不访问真实账号，不能代替真实 ChatGPT 兼容性验收。

`test/browser/manifest-audit.test.mjs`、`scripts/audit-extension.mjs` 约束扩展权限和可注入域名，核对源及打包 Manifest，并生成锁文件许可证清单；GitHub Actions 在同一只读 CI 中执行 `npm audit --audit-level=high`，发现高危以上漏洞就阻断检查。浏览器专用 Playwright 精确版本仅在生产包构建后临时安装，不改动依赖锁文件。执行说明见 `test/browser/README.md`。

## 单标签页存储简化（2026-10-24）

提示词、目录别名和侧边栏设置不再执行跨标签页 CAS、字段旧值比对或冲突重试。存储键与记录格式不变。后台共享串行队列继续协调同一扩展的异步保存与备份操作，保留删除确认、账号归属、容量验证、回滚和删除标记。多个 ChatGPT 标签页同时编辑同一扩展数据不在支持范围内。
