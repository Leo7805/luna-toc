# Stage 10 — PR #16 合并前准入审查

- 复核日期：2026-10-24
- 仓库：`PyRookie1/luna-toc-sc`
- PR：<https://github.com/PyRookie1/luna-toc-sc/pull/16>（准备转为可审查状态；尚未合并）
- 本次最终合并审查的业务代码基准：`cb9b13bf7adc9e3f21be2fbd6c80d57f5885a177`；本次仅同步治理文档，须重新核验包含文档更新的 PR 最新 head。
- 审查基准 main：`03a82a232f180b4f81d0d589ee52265937235974`。
- B026 修复及文档基准 CI：<https://github.com/PyRookie1/luna-toc-sc/actions/runs/40065419469>，success，精确对应 `cb9b13b`：80 个测试文件、526 项单元测试通过；模拟 Chromium 8 项子测试通过；类型检查、构建、打包、供应链审查均成功。更新本验收记录所生成的新 head 的 CI，须在合并授权前另行重新读取。
- 2026-10-24 核对时：main 为 `03a82a232f180b4f81d0d589ee52265937235974`；修复分支相对 main 领先 20 个提交、落后 0 个，GitHub `mergeable_state: clean`。合并前再核对最终 head/base、Ruleset 和最新 CI。

## 准入检查（六项）

| 准入条件 | 当前结果 | 证据或剩余工作 |
|---|---|---|
| ① 阶段功能及缺陷修复 | 通过 | 共享后台写入队列、统计并发、备份预检、孤立统计恢复；B026 页面通知触发持久删除路径已关闭。 |
| ② 新增关键回归测试 | 通过 | 队列、统计、配额、回滚、Chrome 字段顺序、全量渲染与虚拟滚动；B026 伪造页面通知及模拟成功删除测试均通过。 |
| ③ 现有全量测试 | 基准通过，等待最终文档 head CI | 80 文件／526 项测试，模拟 Chromium 8 子测试；此次仅更新治理记录，仍必须核对新提交 CI。 |
| ④ 类型／构建／打包 | 基准通过，等待最终文档 head CI | 最新业务代码基准的 CI 成功；新治理文档提交的 CI 需重新核对。 |
| ⑤ 安全及数据兼容 | 通过（保留已披露边界） | ISOLATED 端不再让网页删除消息调用持久清理。代价：真实删除后保留历史本地别名。存储格式兼容，旧版脚本可能绕过队列；未发现未处理 P0/阻断性 P1。 |
| ⑥ 提交／恢复／治理 | 通过 | 已记录提交、兼容性和回滚；管理员启用 Ruleset [25771265](https://github.com/PyRookie1/luna-toc-sc/rules/25771265)，GitHub 返回 `main.protected:true`、`enforcement:active`、无 bypass、两项必过检查、严格最新提交、禁强推及禁删。 |

**判定：待验收，待核对本次文档更新产生的新 head CI；通过后允许合并，但不代表用户已授权实际合并。** 当前无未处理的 P0/阻断性 P1。功能限制和真实 ChatGPT 未验证范围见下文。

## B026 安全修复及功能取舍

原漏洞：`src/pageHook/conversationLifecycle.ts` 在 MAIN world 观察到成功删除时发布 `TOC_CONVERSATION_DELETED`，但任意同源页面脚本也可以伪造这一消息。原接收端 `src/navigation/lifecycle/conversationLifecycle.ts` 会调用 `tocAliasStore.removeConversation` 并触发本地持久删除标记，形成未受信任消息删除扩展数据的路径。

已采取**非破坏性处理**（提交 `addac7f`）：接收端直接忽略页面删除事件，不再执行本地目录别名及导航缓存删除。同步新增针对伪造事件的单元测试，以及模拟 Chromium 中伪造事件、模拟成功 DELETE 两种情形的存储不变性测试。页面主动刷新及路由切换仍处理正常导航。

代价：即使用户真正删除 ChatGPT 会话，扩展也不再凭页面事件自动删除该会话的本地目录别名。历史别名可能保留在本地存储、备份中；如需恢复自动清理，应另行设计可信删除证据或明确用户确认界面，不可以页面可见 nonce 冒充认证。

尚未验证：真实 ChatGPT 页面和混合版本标签页；回归测试为真实 MV3 扩展搭配模拟网页，而非真实用户账户。

## 数据完整性与回滚审核

- 未新增 Manifest 权限，不更换现有 `chrome.storage.local` 键名及备份版本；主分支数据无需迁移。
- PR #16 将当前版本提示词、使用统计、别名、设置及 JSON 恢复统一为后台串行队列。仅覆盖通过协议执行的新版扩展写入；**不是 Chrome storage 原子事务**，无法阻止旧版内容脚本或任何未来直接写入。
- 备份导出仅读取允许的本地键；导出时过滤孤立使用统计但不改变实际存储；合并恢复清理孤立使用统计；外来无效备份仍被拒绝；目录别名账号归属不符时禁止合并。
- 存储预检使用 `getBytesInUse` 估计配额，写入后进行结构化核对，异常时按原值补偿回滚。补偿回滚不能保证在持续的存储故障或旧脚本并发写入下成功；提示用户保留独立 JSON 备份。
- 回退代码：从合并前主分支提交创建独立修复分支与 PR，使用 `git revert` 方式回退 PR 引入的提交并重新 CI；不强推，不删除标签／Release。回退代码不自动恢复用户数据，用户应先导出 JSON 备份、刷新或关闭旧 ChatGPT 标签页，核对扩展版本与数据兼容性。
- 未验证：真实 ChatGPT 登录态、旧版与新版内容脚本混合运行、实际设备上持久化恢复及 Chrome 存储持续故障。此类范围不可当作模拟测试已完成。

## main 分支保护（已启用并验证）

2026-10-24 仓库管理员完成设置。GitHub API 的 Ruleset 详情已核实：
- [Protect main - Require PR and CI](https://github.com/PyRookie1/luna-toc-sc/rules/25771265)，`enforcement: active`，目标分支 `~DEFAULT_BRANCH`（当前即 `main`），仓库返回 `main.protected: true`。
- 要求 Pull Request，批准数为 0；需要 `Typecheck, test, build and package` 与 `Dependency advisory gate` 两个 GitHub Actions 检查通过，`strict_required_status_checks_policy: true`。
- 启用 `deletion` 与 `non_fast_forward` 规则，禁止删分支及强推；`bypass_actors: []`，当前用户无绕过权。
- 传统 branch protection API 返回 403（集成访问受限），但 Ruleset 详情和分支 `protected:true` 已足以核实该规则生效；不把 403 误认为规则失败。

## 合并前最终操作顺序

1. B026 已实施非破坏性修复并补充回归；如存在新的失败，先修复并重新运行 CI。
2. 确保最新提交的所有 CI 成功，无跳过的必需作业，PR diff 与评审范围一致。
3. `main` 分支保护已启用；合并前仅需复核 Ruleset 仍为 Active。
4. 再核对 PR base/head 和 `mergeable_state`，完结安全及兼容评估，满足六项后将草稿转为 Ready for review。
5. 单独请求用户授权合并；授权前不得执行 `merge`、启用自动合并或触发发布。
