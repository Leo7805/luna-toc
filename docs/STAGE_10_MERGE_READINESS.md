# Stage 10 — PR #16 合并前准入审查

- 复核日期：2026-10-24
- 仓库：`PyRookie1/luna-toc-sc`
- PR：<https://github.com/PyRookie1/luna-toc-sc/pull/16>（当前草稿）
- 审查基准 head：`ab4ac85e0adf343e090f29012c8e0ae820599719`
- 审查基准 main：`03a82a232f180b4f81d0d589ee52265937235974`。
- 已确认最新 head 的 CI：<https://github.com/PyRookie1/luna-toc-sc/actions/runs/40061079667>，success；80 个 Vitest 文件／525 项测试通过；Chromium 7 项子测试通过；类型检查、构建、ZIP 打包、安全检查和 npm 依赖高危公告门槛通过。
- PR 相对 main 领先 17 个提交，落后 0 个；GitHub 合并检测 `clean`。以上证据仅对审查基准提交有效，更新后必须重新核验。

## 准入检查（六项）

| 准入条件 | 当前结果 | 证据或剩余工作 |
|---|---|---|
| ① 阶段功能及缺陷修复 | 已覆盖 | 共享后台写入队列、统计并发、备份预检、孤立统计恢复；原有两项浏览器失败已经修复。 |
| ② 新增关键回归测试 | 通过 | 队列、统计、配额、回滚、Chrome 字段顺序、全量渲染与虚拟滚动。 |
| ③ 现有全量测试 | 通过 | 80 文件／525 测试；模拟 Chromium 7 子测试；未进行真实账号和真实网站验收。 |
| ④ 类型／构建／打包 | 通过 | 最新 CI 构建及 ZIP 校验成功。 |
| ⑤ 安全及数据兼容 | **阻断** | **B026 P1**：同源页面消息被视为删除证明，可执行持久目录别名删除；目前没有防伪校验。存储格式保持兼容，但 Chrome storage 不能提供跨上下文事务，旧版打开的标签页仍可能绕过队列。 |
| ⑥ 提交／恢复／治理 | **阻断** | 提交和回滚方法已记录；GitHub `main` `protected:false`、Rulesets 为 `[]`，无阻止未经 PR 直接推送的保护。 |

**判定：待修复（禁止合并）**。本文件是合并前检查的真实状态，不是合并授权。没有发现该 PR 引入新的权限或本地数据存储键迁移，但不足以证明所有真实浏览器状态安全。

## B026 风险与处理要求

`src/pageHook/conversationLifecycle.ts` 在 MAIN world 观察到成功删除后发送 `TOC_CONVERSATION_DELETED`。接收端 `src/navigation/lifecycle/conversationLifecycle.ts` 只检验消息来源窗口、同源 origin 和永久会话 ID；同一个页面中的其他脚本也能投递满足检查的消息。随后 `tocAliasStore.removeConversation` 触发扩展后台写入持久删除屏障，清除别名。这是局部扩展数据完整性风险，不意味着能凭空删除 ChatGPT 服务器会话；**实际攻击尚未验证**。

合并前必须提供安全的可信删除判据，或明确采用非破坏性通知并调整自动清理行为。不得仅依赖页面可见 nonce、形似正确的 `postMessage` 或页面 GET 的模糊 404。当最终设计确定后需补充「伪造消息不得持久删除别名」「真实已确认删除的清理结果」「恢复与回滚」「旧账户切换」的自动化回归。当前为避免未经确认的行为回归，尚未改变已发布的清理语义。

## 数据完整性与回滚审核

- 未新增 Manifest 权限，不更换现有 `chrome.storage.local` 键名及备份版本；主分支数据无需迁移。
- PR #16 将当前版本提示词、使用统计、别名、设置及 JSON 恢复统一为后台串行队列。仅覆盖通过协议执行的新版扩展写入；**不是 Chrome storage 原子事务**，无法阻止旧版内容脚本或任何未来直接写入。
- 备份导出仅读取允许的本地键；导出时过滤孤立使用统计但不改变实际存储；合并恢复清理孤立使用统计；外来无效备份仍被拒绝；目录别名账号归属不符时禁止合并。
- 存储预检使用 `getBytesInUse` 估计配额，写入后进行结构化核对，异常时按原值补偿回滚。补偿回滚不能保证在持续的存储故障或旧脚本并发写入下成功；提示用户保留独立 JSON 备份。
- 回退代码：从合并前主分支提交创建独立修复分支与 PR，使用 `git revert` 方式回退 PR 引入的提交并重新 CI；不强推，不删除标签／Release。回退代码不自动恢复用户数据，用户应先导出 JSON 备份、刷新或关闭旧 ChatGPT 标签页，核对扩展版本与数据兼容性。
- 未验证：真实 ChatGPT 登录态、旧版与新版内容脚本混合运行、实际设备上持久化恢复及 Chrome 存储持续故障。此类范围不可当作模拟测试已完成。

## main 保护设置（需仓库管理员完成）

此连接没有写入 GitHub Rulesets／分支保护的权限，不能宣称设置已完成。

1. 打开 <https://github.com/PyRookie1/luna-toc-sc/settings/rules>，或从仓库 **Settings → Rules → Rulesets** 进入。
2. 创建 **New ruleset → New branch ruleset**，将分支目标设为 `main`，将规则状态设为 **Active**。
3. 开启 **Require a pull request before merging** 和 **Require status checks to pass**；在近期 PR CI 记录中选择实际存在的 `Typecheck, test, build and package`、`Dependency advisory gate` 两个检查（以 GitHub 当前列出的准确检查名为准）。
4. 禁止强制推送和删除主分支；不为普通推送启用绕过。保存后返回规则列表，确认规则 Active 并覆盖 `main`。
5. 再读取 GitHub Rulesets、主分支保护状态和最新 CI；**保护未确认生效时，不标记准入通过**。

## 合并前最终操作顺序

1. 在 PR #16 原分支修复 B026 或完成等效、安全的非破坏性设计，补充安全回归测试。
2. 确保最新提交的所有 CI 成功，无跳过的必需作业，PR diff 与评审范围一致。
3. 管理员启用并验证 `main` 分支保护。
4. 再核对 PR base/head 和 `mergeable_state`，完结安全及兼容评估，满足六项后将草稿转为 Ready for review。
5. 单独请求用户授权合并；授权前不得执行 `merge`、启用自动合并或触发发布。
