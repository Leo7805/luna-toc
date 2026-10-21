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
| B006 | 2026-10-21 | 页面宽度伪装干扰宿主媒体查询 | Page Hook / Responsive | 旧版宽度伪装改写 `matchMedia`，未完整维护事件监听与对象生命周期。 | 移除不再依赖的宽度伪装，保留浏览器和 ChatGPT 的原生媒体查询。 | 3f0cb90 | No |
| B005 | 2026-10-21 | 刷新后旧分页恢复废弃分支 | Navigation / State | 旧响应晚于权威分支快照返回，没有请求代际检查。 | 传播请求开始时间并拒绝早于已应用快照的数据。 | 86413b4 | Yes |
| B004 | 2026-10-21 | 相同问题可能跳到错误消息 | Navigation / Identity | 文本回退未检查附件和重复提问，默认选择首个匹配节点。 | 只对唯一纯文本提问进行文本回退，拒绝含歧义的 DOM 匹配。 | 13fa2fb | Yes |
| B003 | 2026-10-21 | 提示词失败写入后缓存内容仍被修改 | My Prompts / Storage | 缓存浅拷贝与并发读写导致状态覆盖、回滚不完整。 | 复制提示词记录，串行化同一上下文内的读—改—写操作。 | f674dbe | Yes |
| B002 | 2026-10-14 | Unhandled custom TOC title persistence rejection after extension context invalidation | Custom TOC Titles / Storage | A storage write rejected after Chrome invalidated the content-script context, while the dialog intentionally discarded the async submit promise. | Roll back optimistic cache changes on persistence failure and handle rejected dialog submissions explicitly. | — | No |
| B001 | 2026-10-13 | [First prompt disappears during new-chat route migration](bugs/B001-first-prompt-disappears-new-chat.md) | Navigation / State | ChatGPT's temporary `local-*` conversation route was treated as permanent, so state was dropped during the second identity transition. | Treat `local-*` as temporary and migrate accumulated messages and snapshots across the full temporary route chain. | — | Yes |
