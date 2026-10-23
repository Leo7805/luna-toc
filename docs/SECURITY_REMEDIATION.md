# 第九阶段：依赖漏洞分级与兼容修复

记录日期：2026-10-24。阶段九已通过 PR #15 合并至 `main`，合并提交为 `03a82a232f180b4f81d0d589ee52265937235974`。最新主分支 CI 运行 [#39985205073](https://github.com/PyRookie1/luna-toc-sc/actions/runs/39985205073) 的依赖审查作业报告 0 个已知漏洞，77 个测试文件的 512 项测试通过，Chromium 模拟页面测试通过。

## 初始风险与影响范围

初始 `npm audit --audit-level=high` 报告 23 条包级告警：7 中危、15 高危、1 严重。最高级 `proxy-addr@2.0.7` 来自 `shadcn → @modelcontextprotocol/sdk → express → proxy-addr`。该链属于 Node CLI/服务端依赖，业务 JavaScript 不使用 shadcn CLI。**但原有 `src/styles/tailwind.css` 确实导入了 `shadcn/tailwind.css`**；直接移除 CLI 会造成 Vite 构建失败。本次依据 shadcn 官方 `eject` 方式，将 **shadcn@4.13.1** 的样式工具完整复制到 `src/styles/shadcn-utilities.css`，并修改本地导入；保留 `components.json`。原始 CSS 来自官方仓库 `shadcn@4.13.1` 标签 `packages/shadcn/src/tailwind.css`，MIT 许可见 `docs/VENDOR_LICENSE_SHADCN.md`。是否能在真实页面攻击此漏洞，不能仅根据 npm 告警判断。

其他告警涉及 `vite`、`vitest`、`@vitest/mocker`、`nanoid`、`postcss`、`source-map-js`、`undici` 等。大部分是构建和测试工具依赖，少部分是其传递依赖。最终 Chrome 扩展仅分发构建后的 `dist`，不是整个 `node_modules`；这降低了运行期暴露面，但并不消除 CI/开发机供应链风险。

## 修复方案与约束

1. 从顶层 `dependencies` 移除未被业务 JS 调用的 `shadcn` CLI，**保留其全部 CSS 工具规则的本地副本**，保留 `components.json` 和现有 UI 组件。若未来确需组件生成工具，应作为单独工具链变更重新审核。
2. 不运行 `npm audit fix --force`，也不跳过高危告警。用隔离安装的 npm 11 在 CI 临时工作区完成锁文件的非强制修复（仓库现有 npm 10 的 `audit fix`/`update` 遇到 `edgesOut` 内部错误）；再使用 Node 22/npm 10 `npm ci --ignore-scripts` 验证新锁文件可安装。
3. 更新范围包含 `package.json`、`package-lock.json`、CSS 资源路径和固定版本 CSS 文件、许可声明、安全回归测试及本审查记录；不修改用户存储、Manifest 权限、扩展业务逻辑或发布策略。
4. 对修复后的锁文件继续执行全量 `npm audit --audit-level=high`，不能仅以 `--omit=dev` 避免发现开发工具的已知问题。

## 隔离验证证据与遗留边界

独立验证：[GitHub Actions #39915343653](https://github.com/PyRookie1/luna-toc-sc/actions/runs/39915343653) 的临时修复探针。修复后 `npm audit --json` 统计严重/高危/中危均为 0；删除 288 条失去可达性的锁文件依赖记录，更新 52 个记录（含跨平台可选二进制映射和根项目元数据）。这不是对最终已提交版本的验收结果。

阶段九的自动化准入已由上述主分支 CI 完成。该结果仅表示锁定依赖扫描未发现当前 npm 公告库中达到 high/critical 门槛的已知问题，并不代表零漏洞或真实 ChatGPT 页面已通过验收。真实登录态、宿主 DOM、网络故障和编辑历史分支仍不在模拟浏览器覆盖范围。

回退：可整体回退本次依赖修复提交；恢复到旧锁文件会恢复已知漏洞，不能当成安全修复。扩展业务源码和本地数据格式未变化。
