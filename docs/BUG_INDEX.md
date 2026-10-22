# Bug Index

This document is the master registry for tracking bugs and regressions in LunaTOC-SC.

## ID & Ordering Rules

- **Permanent Sequential IDs**: Assigned in recording order (`B001`, `B002`, `B003`, ...).
- **Immutable**: Once assigned, an ID never changes. Never renumber existing bugs. New bugs receive the next available ID.
- **Newest-First**: Display bugs newest-first so higher/newer IDs appear above older IDs.
- **Detail Documents**: Important bugs link from the `Bug` column to a concise detail document in `bugs/`. Small bugs exist only as one row in this table.
- **Showcase**: Set to `Yes` if the bug carries notable engineering, portfolio, or case-study value; otherwise `No`.
- **Commit**: Record the short commit hash after the fix is committed; use `—` if pending.

---

| ID | Date | Bug | Area | Root Cause | Fix | Commit | Showcase |
|---|---|---|---|---|---|---|---|
| B019 | 2026-10-22 | 探索菜单目的地无法右键打开新标签及项目位置不便 | Native Sidebar / Explore | 旧实现只检查原生 button，遗漏 role=menuitem、定时任务、财务、地图、站点等入口；项目没有独立常驻入口。 | 扩大可访问名称和菜单项识别，为资料库后面创建独立项目链接，隐藏探索菜单内重复入口，并覆盖菜单重挂载。 | — | No |
| B018 | 2026-10-22 | 右键收起后顶部隐藏的问题目录未恢复可见 | TOC / Sidebar | 收起展开标题只更新状态，没有在问题行被顶部顶栏遮挡时恢复侧边栏目录滚动位置。 | 收起前判断问题行是否在无遮挡顶部之上，收起后重新测量并将该目录对齐可见顶部；下方溢出或原本可见时不滚动。 | — | No |
| B017 | 2026-10-22 | 完整可见的展开目录仍显示多余上下边界操作 | TOC / Sidebar | 只判断标题是否展开，没有检查当前问题行和展开标题内容是否已全部处于无遮挡的侧边栏可视区；悬浮工具隐藏宽限过长。 | 按当前 DOM 可视区域与顶栏遮挡判断菜单操作是否必要，重校验失效菜单操作；缩短工具隐藏宽限至 400ms。 | — | No |
| B016 | 2026-10-22 | 展开目录边界被顶部毛玻璃遮挡且无法显示下一个目录 | TOC / Sidebar | 首项标题而不是当前目录行被用作顶部锚点，未使用顶栏实际可见边界；底部只对齐末项标题；悬浮工具移开立即隐藏。 | 顶部对齐完整目录行并避开顶栏；底部优先露出下一可见目录；工具组鼠标离开延迟 1 秒隐藏。 | — | No |
| B015 | 2026-10-22 | 右键目录边界定位误操作 ChatGPT 正文 | Sidebar / TOC | 将仅面向侧边栏展开标题列表的上下边界误实现为宿主 ChatGPT 对话区域导航，收起时也暴露操作。 | 将菜单与滚动目标限定为已展开标题列表；收起时隐藏操作并校验实时消息身份。同步缩短右缘工具组延迟为 50ms。 | — | No |
| B014 | 2026-10-22 | 会话 GET 状态误删风险及目录维护回归 | Lifecycle / TOC / UI | 404 可能来自接口不兼容；别名保存与删除并发；菜单使用固定高度；刷新超时不失效；隐藏标题与连接节点内容变化处理不足。 | 启动仅识别账号，只有已确认删除操作清理；别名写入与删除串行并防止过期写入；菜单实测定位；刷新超时未验证；标题过滤与缓存更新；按需清理旧设置。 | — | Yes |
| B013 | 2026-10-22 | 会话删除后目录关联数据和导航缓存残留 | Navigation / Lifecycle | 本地收藏与导航快照没有统一逐会话清理，启动无法确认已删除会话；提示词使用统计删除后可能孤立。 | 新增启动时账号绑定校验、成功删除通知、快照容量限制与删除接口、未验证快照状态，并对独立提示词统计进行本地核对。 | — | Yes |
| B012 | 2026-10-21 | 全透明默认背景降低侧边栏可读性 | Sidebar / Appearance | B011 将背景和顶部栏改为完全透明，内容与网页文字叠加影响观感。 | 恢复 v1.13.16 的浅蓝/深蓝半透明底色和背景模糊，保留 B010 的快速收起优化。 | — | No |
| B011 | 2026-10-21 | 默认背景仍显示微蓝色 | Sidebar / Appearance | 默认预设返回空覆盖值，CSS 回落到原有蓝色半透明背景且保留 backdrop-filter。 | 明确使用透明背景及顶部栏覆盖，禁用默认模式的背景模糊，默认色卡显示透明。 | — | No |
| B010 | 2026-10-21 | 鼠标离开侧边栏后自动收起迟缓 | Sidebar / Auto-hide | 300ms 收起延迟叠加 160ms 滑出动画。 | 缩短为 60ms 延迟和 100ms 动画，保持固定与悬停保护。 | — | No |
| B009 | 2026-10-21 | 并排布局未作用于实际 ChatGPT 对话区 | ChatGPT / Layout | 原实验仅给顶层应用节点预留宽度，内部主列不一定重排。 | 将对话主列适配与显隐设置一起集成到 main，窄窗口回退并新增端到端生命周期单测。 | — | No |
| B008 | 2026-10-21 | 悬浮按钮展开后项目对话目录未自动刷新 | Navigation / Refresh | 内容脚本与 MAIN world 的路由识别不一致，项目路径刷新请求被拒绝；仅完整会话请求捕获鉴权头。 | 统一路由解析，兼容项目对话并捕获分页请求鉴权头，加入刷新回归测试及失败日志。 | — | Yes |
| B007 | 2026-10-21 | 跳转底部后手动向上滚动被自动纠偏拉回 | Navigation / Scroll | 跳转重试只检查滚动位置，未区分宿主虚拟列表偏移和用户主动滚动。 | 监测对话区域滚轮、触控、指针和有效键盘滚动输入，立即取消当前边缘跳转，保留宿主自动偏移纠正。 | — | Yes |
| B006 | 2026-10-21 | 页面宽度伪装干扰宿主媒体查询 | Page Hook / Responsive | 旧版宽度伪装改写 `matchMedia`，未完整维护事件监听与对象生命周期。 | 移除不再依赖的宽度伪装，保留浏览器和 ChatGPT 的原生媒体查询。 | 3f0cb90 | No |
| B005 | 2026-10-21 | 刷新后旧分页恢复废弃分支 | Navigation / State | 旧响应晚于权威分支快照返回，没有请求代际检查。 | 传播请求开始时间并拒绝早于已应用快照的数据。 | 86413b4 | Yes |
| B004 | 2026-10-21 | 相同问题可能跳到错误消息 | Navigation / Identity | 文本回退未检查附件和重复提问，默认选择首个匹配节点。 | 只对唯一纯文本提问进行文本回退，拒绝含歧义的 DOM 匹配。 | 13fa2fb | Yes |
| B003 | 2026-10-21 | 提示词失败写入后缓存内容仍被修改 | My Prompts / Storage | 缓存浅拷贝与并发读写导致状态覆盖、回滚不完整。 | 复制提示词记录，串行化同一上下文内的读—改—写操作。 | f674dbe | Yes |
| B002 | 2026-10-14 | Unhandled custom TOC title persistence rejection after extension context invalidation | Custom TOC Titles / Storage | A storage write rejected after Chrome invalidated the content-script context, while the dialog intentionally discarded the async submit promise. | Roll back optimistic cache changes on persistence failure and handle rejected dialog submissions explicitly. | — | No |
| B001 | 2026-10-13 | [First prompt disappears during new-chat route migration](bugs/B001-first-prompt-disappears-new-chat.md) | Navigation / State | ChatGPT's temporary `local-*` conversation route was treated as permanent, so state was dropped during the second identity transition. | Treat `local-*` as temporary and migrate accumulated messages and snapshots across the full temporary route chain. | — | Yes |
