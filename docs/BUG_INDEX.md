# Bug History

Historical bug and regression records.

| ID | Date | Bug | Area | Root Cause | Fix | Commit | Showcase |
|---|---|---|---|---|---|---|---|
| B035 | 2026-10-26 | 扩展主题标记覆盖 ChatGPT 页面主题属性，导致页面样式冲突 | Theme / Content Script | 内容脚本将扩展主题写入 `document.documentElement.dataset.theme`，全局 CSS 又根据 `html[data-theme]` 切换配色，污染宿主页面的主题状态。 | 使用独立 `data-luna-toc-theme` 标记，并让全局样式与 Shadow DOM 主题同步只读取扩展标记；增加单测和 Chromium 回归。 | — | No |
| B036 | 2026-10-26 | 点击回答标题后黄色高亮持续存在 | Navigation / Outline (P2) | 标题跳转后添加 `chat-toc-outline-heading-highlight`，但没有对应的自动清除计时器。 | 使用与问题蓝色轮廓相同的 600ms 高亮时长，并在新跳转或导航取消时清理旧计时器；增加计时器回归测试。 | — | No |
| B034 | 2026-10-24 | [ChatGPT 回答中的 Markdown 粗体标记未渲染](bugs/B034-markdown-bold-rendering.md) | ChatGPT / Rendering (P2) | 用户报告完整的 `**文本**` 标记原样显示；真实 ChatGPT DOM 根因尚未现场核实，暂按标记落入普通文本节点处理。 | 只在助手 `.markdown` 中将安全的完整标记转换为 `strong`，跳过代码、数学、转义和不完整标记；增加 DOM 更新观察、单测和 Chromium 回归。 | 00e55d4 | Yes |
| B033 | 2026-10-24 | [目录标题跳转与边缘跳转冲突](bugs/B033-outline-edge-navigation-conflict.md) | Navigation / Scroll (P2) | 标题跳转使用独立的 `outlineJumpVersion` 管理延迟重试和下一帧校正；边缘跳转只取消虚拟滚动导航，没有使旧标题跳转失效。 | 顶部/底部跳转前调用 `cancelOutlineNavigation()`，清除旧标题高亮并阻断过期校正；新增控制器顺序回归测试。 | c5f3aa2 | Yes |
| B032 | 2026-10-24 | 已删除 ChatGPT 会话可能留下本地目录别名，自动清理又存在网页伪造删除风险 | Options / Alias / Lifecycle | B026 阻断不可信页面删除事件后，缺少用户主动逐条清理本地孤立数据的入口。 | 继续保留先备份、用户确认、预览记录条件匹配和持久删除保护；新版本额外自动清理未绑定账号的旧别名。**远端会话删除后自动清理仍未解决**，不得信任网页 `postMessage`。 | 42ff388, 433b98b, 0ee1c0d, 54c1761, df04d34, 9173953, a602ced, c476f4, a344ce8 | Yes |
| B031 | 2026-10-24 | 历史补全 fetch/JSON 长时间挂起，导致会话标记无法释放且迟到响应可能混入旧路由 | Page Hook / Backfill | 后台分页只有页面数上限，无请求超时、取消信号及重复游标保护。 | 每页超时、AbortController 与不响应 abort 的请求竞态释放；路由变化终止旧任务、阻断迟到数据；重复游标立即停止；新增回归用例。 | 8d2c2d5, a676f83, 6fabfba | Yes |
| B030 | 2026-10-24 | 多个设置页基于过期完整快照保存侧边栏偏好，覆盖其他字段 | Sidebar / Storage | 共享写入队列只串行执行，完整对象直接覆盖导致陈旧基线丢失更新。 | 字段级补丁在共享队列中按字段旧值做条件提交，冲突拒绝覆盖；设置页刷新当前值并提示，保存期间阻止连点；旧版完整对象只允许初始化/幂等读取，不再覆盖有效现有设置；增加跨标签页、备份、异常输入和界面回归测试。 | 9781919, b9c53cd, 43042fb, f527e96, f2c08cb, a865f24, 5f4ec37, 674fbbb, 7b8e01a, 0dddded | Yes |
| B029 | 2026-10-24 | 清空提示词与使用统计分两次提交，可能部分成功或穿插异步写入 | My Prompts / Storage | UI 分别删除提示词与统计；后台没有清空整个业务操作的前置条件与补偿回滚。 | 集中为后台 clear-all 条件提交，双键写入后核验；失败恢复旧值；过期记录使用次数不能重新创建已删除 ID。 | 852de72, ca8e974, 4e8a7db | Yes |
| B028 | 2026-10-24 | 备份接受正常目录存储模块拒绝的消息 ID | Backup / Validation | 恢复解析仅校验非空和长度，未排除普通写入时禁止的对象原型保留字段。 | 备份模块复用 `isValidTocMessageId`，导入前拒绝危险字段；保留允许的特殊会话 ID 结构。 | 196c594, 22ee4ac | Yes |
| B027 | 2026-10-24 | 网页身份事件可伪造，目录别名展示缺少匹配当前账号校验 | Lifecycle / Alias / Trust | ISOLATED world 信任同源页面传入的账号 ID，目录 UI `get` 返回标签页缓存而未校验归属。 | 隔离环境独立请求 session；代际隔离晚到响应；只显示与当前可信账号一致的别名；新版本删除未绑定账号的旧别名，不自动认领。远端会话删除后的自动清理仍由 B032 跟踪。 | c2e6e86, 9915d75, 6d485fa, a602ced, c476f4, a344ce8 | Yes |
| B026 | 2026-10-24 | 页面同源 `postMessage` 可伪造会话删除通知，进而删除扩展本地目录别名 | Lifecycle / Trust boundary | `conversationLifecycle.ts` 接收消息仅检查 `source`、`origin` 与会话 ID，不能证明是可信删除；旧实现直接调用持久删除。 | **已修复页面消息触发持久删除路径（P1）**：ISOLATED world 忽略所有来自网页的删除通知，不删除别名或缓存；新增单元及模拟 Chromium 伪造/成功删除回归。代价：ChatGPT 删除后别名暂不自动清理。 | addac7f | Yes |
| B024 | 2026-10-24 | 备份恢复与提示词、别名、设置等写入可能交错 | Storage / Backup | 各存储模块拥有独立队列，批量恢复直接写入多个键；使用统计也在每个标签页本地读改写。 | 统一共享后台写入队列，使用统计按最新持久值原子化递增；恢复前检查预计容量，写入后核对并在失败时补偿回滚。 | 5909aba, 27ffd15 | Yes |
| B025 | 2026-10-24 | 备份恢复可能超过 Chrome 本地存储配额 | Storage / Backup | 备份文件 12 MiB 上限高于 Chrome 本地存储默认 10 MiB 配额，导入文件通过格式校验仍可能无法写入。 | 使用 getBytesInUse 预估恢复后的容量，超限时在写入前拒绝；不新增 unlimitedStorage 权限。 | 27ffd15 | No |
| B023 | 2026-10-23 | 兼容性工具栏告警无法随页面恢复自动消除 | Contract Alert / Toolbar / Page Hook | 旧实现只在整页 loading 时清理，SPA 路由变化、DOM 标记恢复及接口契约恢复没有对应清除路径；异步消息可能乱序覆盖新状态。 | 内容脚本对异常与恢复分别上报并带版本；后台按标签页串行保存并保留健康版本屏障；页面切换重置检测并复检，DOM 双次健康采样、PING/PONG 与接口正向匹配自动恢复，新增单元回归测试。 | e3450af, c8902b3 | Yes |
| B022 | 2026-10-23 | 历史编辑分支缺少父节点时目录误判及晚到分页混入旧分支 | Navigation / State / Jump | 扁平消息缺少 `current_node` 父链仍被当作权威快照；已验证快照之后的新分页可能合并废弃分支；文本前缀匹配易误定位。 | 校验映射/分页父链，不可确定时保留旧目录并标记未验证；快照标记验证来源；隔离已验证分支与后续无证据分页；路由/分支变化取消旧导航，文本回退要求完整匹配；新增回归测试。 | 11eb0b7, e0c69b9, 03f302f, 674b24d, 3fda733 | Yes |
| B021 | 2026-10-23 | 会话目录刷新超时后底层请求仍挂起、重试复用旧任务 | Navigation / Page Hook | 控制器 15 秒计时器只改变界面状态，页面钩子 inFlight 未释放且 fetch 缺少 AbortSignal；晚到结果可能混入后续刷新。 | MAIN/ISOLATED 之间增加按请求编号取消；AbortController 贯穿完整会话及分页获取，双端超时、路由切换释放任务；过期结果拒绝发布，补充自动回归测试。 | f58812b, af15e30, 00c5f01, 6d5489e | Yes |
| B020 | 2026-10-23 | 自定义目录名称的跨标签页并发覆盖和删除后复活风险 | TOC / Storage | 标签页各自排队读改写同一会话别名对象；删除仅有本页内存屏障，其他标签页可重新写入。 | 后台按消息条件提交，编辑起点冲突检测；明确删除建立持久屏障，备份显式恢复按记录清理屏障。 | 2df9f66, 7b4fa94 | Yes |
| B019 | 2026-10-23 | 多标签页同时修改提示词会覆盖其他标签页的数据 | My Prompts / Storage | 每个内容脚本只维护当前标签页的写入队列，跨标签页读—改—写未统一协调，导致最后一次整表写入覆盖其他操作。 | 将普通提示词写入集中到后台条件提交队列；并发修改不同记录可合并，同一记录冲突直接失败；整表替换要求原始读取快照，保留旧存储键。 | 48eec1b | Yes |
| B018 | 2026-10-22 | 右键收起后顶部隐藏的问题目录未恢复可见 | TOC / Sidebar | 收起展开标题只更新状态，没有在问题行被顶部顶栏遮挡时恢复侧边栏目录滚动位置。 | 收起前判断问题行是否在无遮挡顶部之上，收起后重新测量并将该目录对齐可见顶部；下方溢出或原本可见时不滚动。 | 9ce11439b0 | No |
| B017 | 2026-10-22 | 完整可见的展开目录仍显示多余上下边界操作 | TOC / Sidebar | 只判断标题是否展开，没有检查当前问题行和展开标题内容是否已全部处于无遮挡的侧边栏可视区；悬浮工具隐藏宽限过长。 | 按当前 DOM 可视区域与顶栏遮挡判断菜单操作是否必要，重校验失效菜单操作；缩短工具隐藏宽限至 400ms。 | e156500285 | No |
| B016 | 2026-10-22 | 展开目录边界被顶部毛玻璃遮挡且无法显示下一个目录 | TOC / Sidebar | 首项标题而不是当前目录行被用作顶部锚点，未使用顶栏实际可见边界；底部只对齐末项标题；悬浮工具移开立即隐藏。 | 顶部对齐完整目录行并避开顶栏；底部优先露出下一可见目录；工具组鼠标离开延迟 1 秒隐藏。 | 76c088c42b | No |
| B015 | 2026-10-22 | 右键目录边界定位误操作 ChatGPT 正文 | Sidebar / TOC | 将仅面向侧边栏展开标题列表的上下边界误实现为宿主 ChatGPT 对话区域导航，收起时也暴露操作。 | 将菜单与滚动目标限定为已展开标题列表；收起时隐藏操作并校验实时消息身份。同步缩短右缘工具组延迟为 50ms。 | 2bd24f8960 | No |
| B014 | 2026-10-22 | 会话 GET 状态误删风险及目录维护回归 | Lifecycle / TOC / UI | 404 可能来自接口不兼容；别名保存与删除并发；菜单使用固定高度；刷新超时不失效；隐藏标题与连接节点内容变化处理不足。 | 启动仅识别账号，只有已确认删除操作清理；别名写入与删除串行并防止过期写入；菜单实测定位；刷新超时未验证；标题过滤与缓存更新；按需清理旧设置。 | b4125f80aa, b29e54e011, b24f04cf18, af15e300fa | Yes |
| B013 | 2026-10-22 | 会话删除后目录关联数据和导航缓存残留 | Navigation / Lifecycle | 本地收藏与导航快照没有统一逐会话清理，启动无法确认已删除会话；提示词使用统计删除后可能孤立。 | 新增启动时账号绑定校验、成功删除通知、快照容量限制与删除接口、未验证快照状态，并对独立提示词统计进行本地核对。 | b4125f80aa, 6f4fe3c49c | Yes |
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
