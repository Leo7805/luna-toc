# 第九阶段：依赖漏洞分级与兼容修复

记录日期：2026-10-23。工作分支：`stage-09-browser-e2e-security`；PR #15（草稿）。本记录以提交前的独立 CI 诊断为依据，最终合并准入必须以变更提交后的全部 CI 作业为准。

## 初始风险与影响范围

初始 `npm audit --audit-level=high` 报告 23 条包级告警：7 中危、15 高危、1 严重。最高级 `proxy-addr@2.0.7` 来自 `shadcn → @modelcontextprotocol/sdk → express → proxy-addr`。该链属于 Node CLI/服务端依赖，未见在扩展的业务代码中使用 shadcn CLI；`components.json` 仅是生成器配置，不要求运行期安装 CLI。是否能在真实页面攻击此漏洞，不能仅根据 npm 告警判断。

其他告警涉及 `vite`、`vitest`、`@vitest/mocker`、`nanoid`、`postcss`、`source-map-js`、`undici` 等。大部分是构建和测试工具依赖，少部分是其传递依赖。最终 Chrome 扩展仅分发构建后的 `dist`，不是整个 `node_modules`；这降低了运行期暴露面，但并不消除 CI/开发机供应链风险。

## 修复方案与约束

1. 从顶层 `dependencies` 移除无实际运行调用的 `shadcn`，保留 `components.json` 和现有 UI 源代码。若未来确需组件生成工具，应作为单独工具链变更重新审核。
2. 不运行 `npm audit fix --force`，也不跳过高危告警。用隔离安装的 npm 11 在 CI 临时工作区完成锁文件的非强制修复（仓库现有 npm 10 的 `audit fix`/`update` 遇到 `edgesOut` 内部错误）；再使用 Node 22/npm 10 `npm ci --ignore-scripts` 验证新锁文件可安装。
3. 更新范围仅限 `package.json`、`package-lock.json`、测试 CI 配置的清理和本审查记录；不修改用户存储、Manifest 权限、扩展源代码、发布策略。
4. 对修复后的锁文件继续执行全量 `npm audit --audit-level=high`，不能仅以 `--omit=dev` 避免发现开发工具的已知问题。

## 隔离验证证据与遗留边界

独立验证：[GitHub Actions #39915343653](https://github.com/PyRookie1/luna-toc-sc/actions/runs/39915343653) 的临时修复探针。修复后 `npm audit --json` 统计严重/高危/中危均为 0；删除 288 条失去可达性的锁文件依赖记录，更新 52 个记录（含跨平台可选二进制映射和根项目元数据）。这不是对最终已提交版本的验收结果。

最终准入仍需以 PR 最新 HEAD 的 CI 为准，执行 `npm ci`、类型检查、512 项既有测试、扩展构建与 ZIP 检查、Manifest/许可证审计、Chromium 自动化 E2E 和完整依赖公告扫描，并复查归档内容。真实 ChatGPT 登录态与页面结构未纳入此次模拟浏览器测试。

回退：可整体回退本次依赖修复提交；恢复到旧锁文件会恢复已知漏洞，不能当成安全修复。扩展业务源码和本地数据格式未变化。
