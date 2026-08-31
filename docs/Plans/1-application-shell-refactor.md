# Plan 1: `applicationShell.ts` 重构

## 思路

把 `src/app/applicationShell.ts` 拆成 3 个新模块,主入口降为 ~70 行的编排器。匹配 pageHook 拆分先例的 100-300 行规模。`navigatorController` 公共 API、DOM id 集合、CSS 变量、sessionStorage key 全部保持不变。

## TODO 大纲

- [x] 1. 抽取 jump-controls 拖拽逻辑到独立模块(已完成)
- [ ] 2. 抽取 sidebar DOM 构造到独立模块
- [ ] 3. 抽取 sidebar 状态与事件绑定到独立控制器
- [ ] 4. 重写 `applicationShell.ts` 为薄编排入口
- [ ] 5. 验证构建与功能

## 跨 Plan 约定

- 文件大小目标 100-300 行,硬上限 500 行(per [`TEMPLATE_Common.md` File Size](~/Projects/ai-agent-rules/TEMPLATE_Common.md))
- 严格保持 `navigatorController` 公共 API、DOM id 集合、CSS 变量、sessionStorage key 完全不变
- 新文件首次进入 import 图 → 必跑完整 `pnpm sbuild`(不是只 typecheck),然后 `chrome://extensions` 重载(详见 [chrome-extension-stale-build-diagnosis](.claude/projects/-Users-leo-Projects-chrome-plugins-luna-toc/memory/chrome-extension-stale-build-diagnosis.md))
- 一个 batch 一个 PR;不在主任务里夹带清理
- Plan 1 完成后,Plan 2 才开工(Plan 2 见 [2-session-storage-helper.md](2-session-storage-helper.md))

## batch 1 完成(已完成)

- 新增 [`src/features/jumpControls/jumpControls.ts`](src/features/jumpControls/jumpControls.ts)(159 行)
  - `initJumpControlsPositioning()` — 模块入口,绑定 pointer 拖拽、resize 重夹、sessionStorage 恢复
  - 私有:`saveJumpControlsPosition` / `restoreJumpControlsPosition` / `keepJumpControlsInViewport` / `setJumpControlsPosition` / `storageGet` / `storageSet` / `clampJumpControlsTop` / `getJumpControlsTopRatio` / `getSavedJumpControlsTop`
- 修改 [`src/app/applicationShell.ts`](src/app/applicationShell.ts)(675 → 526 行)
  - 新增:`import { initJumpControlsPositioning } from '@/features/jumpControls/jumpControls';`
  - 删除:`JumpControlsPosition` 接口、`JUMP_CONTROLS_POSITION_STORAGE_KEY` 常量、9 个 jump-controls 函数、inline `storageGet`/`storageSet`
- 验证:`pnpm typecheck` ✓ / `pnpm sbuild` ✓ / `pnpm test` ✓ (34 文件 / 186 用例)

## batch 2 — 抽 sidebar DOM 构造

**思路:** sidebar DOM 模板字符串(95 行 `innerHTML`)+ `waitForBody` Promise + `escapeHtml` 都是纯 DOM 构造,跟状态机/事件绑定无关,完全可以独立。`createSidebar()` 返回已 append 的 sidebar 元素。

**改动清单:**

- 新增 [`src/app/sidebarView.ts`](src/app/sidebarView.ts)(~95 行)
  - `createSidebar(): Promise<HTMLElement>` — `await waitForBody()` + 构建 sidebar DOM + append `document.body` + 返回
  - 私有:`waitForBody`(~15 行,本地副本)、`escapeHtml`(~12 行)
- 修改 [`src/app/applicationShell.ts`](src/app/applicationShell.ts)
  - 新增:`import { createSidebar } from './sidebarView';`
  - 删除:`waitForBody` 函数、`escapeHtml` 函数、`createSidebar` 函数整段
  - `initializeApplication` 中 `const sidebar = await createSidebar();` 不变
  - 注意:`bindSidebarControls()` 调用仍在 `createSidebar` 内部末尾;`bindSidebarControls` 本 batch 不动,留给 batch 3

**步骤:**

- [ ] 2.1 新建 `src/app/sidebarView.ts`,把 `applicationShell.ts` 中的 `waitForBody` / `escapeHtml` / `createSidebar` 整块搬过去,导出 `createSidebar`
- [ ] 2.2 `applicationShell.ts` 顶部加 `import { createSidebar } from './sidebarView';`
- [ ] 2.3 删除 `applicationShell.ts` 内的 `waitForBody` / `escapeHtml` / `createSidebar`,`initializeApplication` 中 `const sidebar = await createSidebar();` 不变
- [ ] 2.4 保持调用顺序:`createSidebar()` 仍在 `applyStackingConfig` 之后、`navigatorController.attach` 之前

**验证:**

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm sbuild` 完整构建,`.output/chrome-mv3/` 时间戳更新(新文件 +1)
- [ ] `pnpm test` 通过
- [ ] Chrome 中 sidebar 正常出现,CSS 变量 `--navigator-width/min/max` 生效,`#navigator-list` / `#navigator-title` / `#navigator-search` 等 DOM id 都存在

**风险:** `waitForBody` 搬到 `sidebarView.ts` 后,`applicationShell.ts` 不再有该函数定义。当前只有 `createSidebar` 内部 `await` 它,无其他引用。

## batch 3 — 抽 sidebar 状态与事件绑定

**思路:** `viewMode` / `searchQuery` / counts 这五个 module-level `let` + 事件绑定 + 标题派生 + 视图分发,合计 ~220 行。用 IIFE 闭包控制器模式(参照 [`tooltip.ts`](src/features/tooltip.ts) 的 `previewTooltip` / `buttonTooltip` 风格),导出方法供 `applicationShell.ts` 调用。

**改动清单:**

- 新增 [`src/app/sidebarController.ts`](src/app/sidebarController.ts)(~220 行)
  - `init()` — 同步;绑定 `#search-toggle-btn` / `#navigator-title` / jump 按钮 / `#navigator-search` / `#toggle-view-mode-btn`,假设 sidebar DOM 已存在
  - `setViewMode(mode)` / `toggleViewMode()` / `clearSearch()`
  - `setPromptCount(n)` / `setMyPromptsCount(n)` — 由 `navigatorController` 回调和 `myPrompts.onPromptsChanged` 调用
  - `refreshMyPromptsIfActive()` — 当前 `applicationShell.ts` 行 597-606 处的 microtask 防抖刷新
  - `handleSavePrompt(message)` — 接为 `navigatorController` 的 `onSavePrompt`
  - `setNavigatorTitle()` — 接为 `navigatorController` 的 `onTitleChanged`
  - 私有:`bindSidebarControls` / `renderCurrentView` / `renderMyPrompts` / `handleTitleClick` / `handleJumpControlClick` / `handleJumpControlDoubleClick` / `scrollNavigatorListToEdge` / `getConversationTitle` / `updateSearchAvailability` / `getRequiredElement`
- 修改 [`src/app/applicationShell.ts`](src/app/applicationShell.ts)
  - 新增:`import { sidebarController } from './sidebarController';`
  - 删除:五个 module-level `let`、~14 个函数(~220 行)
  - `navigatorController.init({...})` 回调全部指到 `sidebarController` 方法
  - 在 `await createSidebar()` 之后调用 `sidebarController.init()`
  - `myPrompts.onPromptsChanged` 订阅改为 `sidebarController` 方法

**步骤:**

- [ ] 3.1 新建 `src/app/sidebarController.ts`,按 IIFE 模式写闭包控制器,导出上述方法
- [ ] 3.2 把 `applicationShell.ts` 的 module-level state、事件绑定、标题派生、视图分发全部删除
- [ ] 3.3 改 `navigatorController.init({...})` 回调全部指到 `sidebarController` 方法
- [ ] 3.4 在 `await createSidebar()` 后调用 `sidebarController.init()`
- [ ] 3.5 改 `myPrompts.onPromptsChanged` 订阅

**验证:**

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm sbuild` 完整构建,`.output/chrome-mv3/` 时间戳更新(新文件 +1)
- [ ] `pnpm test` 通过
- [ ] Chrome 中:
  - [ ] sidebar 标题显示当前会话标题(`getConversationTitle` 工作)
  - [ ] 主机侧重命名会话,sidebar 标题同步(`onTitleChanged`)
  - [ ] 搜索框输入,TOC 过滤(`searchQuery` 状态正确流向 `navigatorController`)
  - [ ] 点击 `#toggle-view-mode-btn`,TOC ↔ My Prompts 切换,搜索框在切换时被清空
  - [ ] 右键 TOC 条目弹出保存对话框,保存后回到 TOC 视图(`handleSavePrompt`)
  - [ ] 切换会话时搜索框清空 + 标题更新(`onRouteChanged`)
  - [ ] 新建会话发第一条 prompt,不卡在 "Loading... (1 so far)"(`onPromptAdded` 触发的 `setViewMode('toc')` 及时)

**风险:** 这是最大一次状态迁移。`viewMode` / `searchQuery` 是跨多个回调闭包共享的 module-level state,IIFE 闭包要保证可变,不能错改成 `const`。

## batch 4 — 重写 `applicationShell.ts` 为薄编排入口

**思路:** batch 2/3 已把 DOM 构造和状态机搬走,剩余只剩侧边栏缩放、主题初始化、CSS 变量发布、`initializeApplication` 编排本身。`initTheme` / `applyStackingConfig` / `initSidebarResize` 是单消费者,继续 inline。

**改动清单:**

- 修改 [`src/app/applicationShell.ts`](src/app/applicationShell.ts)(目标 ~70 行)
  - 删除:`ConversationEdge` / `ViewMode` 类型别名(已搬到 sidebarController)
  - 确认:`applyStackingConfig` / `initTheme` / `initSidebarResize` 保留
  - `initializeApplication` 流程收紧到 ~30 行
- 行数目标:526 → ~70 行

**步骤:**

- [ ] 4.1 确认 `applyStackingConfig` / `initTheme` / `initSidebarResize` 内联保留
- [ ] 4.2 删除 `ConversationEdge` / `ViewMode`(已迁到 sidebarController)
- [ ] 4.3 收紧 `initializeApplication`,每条调用一行注释其角色
- [ ] 4.4 更新文件头注释为「内容脚本编排入口」

**验证:**

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm sbuild` 完整构建
- [ ] `pnpm test` 通过
- [ ] 行为与重构前一致(回归测试):所有 batch 2/3/4 的功能验证项仍通过

**风险:** 删多 / 删少都可能。需要在编辑前后用 `git diff` 比对 import 集合、函数集合,确认没漏搬。

## batch 5 — 验证构建与功能

**步骤:**

- [ ] 5.1 `pnpm typecheck` 通过
- [ ] 5.2 `pnpm sbuild` 完整构建,`.output/chrome-mv3/` 时间戳更新
- [ ] 5.3 `pnpm test` 全过
- [ ] 5.4 Chrome 手动冒烟(sidebar 出现、搜索过滤、jumpControls 拖拽持久化、视图切换、标题同步、跨会话切换、resize 重定位、保存对话框)
- [ ] 5.5 若 sidebar 不出现,按 [chrome-extension-stale-build-diagnosis](.claude/projects/-Users-leo-Projects-chrome-plugins-luna-toc/memory/chrome-extension-stale-build-diagnosis.md) 排查:`pnpm sbuild` 是否新跑、`chrome://extensions` 是否重载、Chrome 是否需要重启清缓存
- [ ] 5.6 DevTools → Application → Session Storage,确认 `chatTocJumpControlsPosition` / `chatTocToggleButtonPosition` / `chatTocSidebarPinned` 仍正常读写

## Plan 1 暂不处理(刻意避开,留给 Plan 2 或后续 PR)

- 统一三处重复的 `storageGet` / `storageSet` → 见 [2-session-storage-helper.md](2-session-storage-helper.md)
- 提取三处重复的 conversation-id 正则解析助手(`applicationShell.ts`、`navigatorController.ts`、`sidebarVisibility.ts`)
- 统一 `applicationShell.ts` 与 `content.ts` 重复的 `waitForBody`(Plan 1 batch 2 已搬到 sidebarView.ts,只剩 `content.ts` 内的副本)
- 引入 viewport-clamp 共享助手(jumpControls 与 toggleButton 拖拽实现差异过大,不强行抽象)
- jumpControls 缺少 `dataset.dragged` 标志位(已知潜在缺陷,非本次范围)

## Plan 1 顺序与依赖

batch 之间有强顺序依赖:

1. **batch 2 必须在 batch 3 之前**(sidebarView 在 sidebarController 之前抽,因为 sidebarController.init 假设 sidebar DOM 已存在)
2. **batch 3 必须在 batch 4 之前**(sidebarController 抽走后,applicationShell 才能瘦下来)
3. **batch 4 完成后 batch 5 才能验证**

batch 1 已独立完成。Plan 2 在 Plan 1 全部完成后再开新 PR。