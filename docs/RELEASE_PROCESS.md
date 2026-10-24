# 构建、发布与恢复说明

更新日期：2026-10-23；适用版本：v1.13.34 起。

## 当前实现

- `.github/workflows/ci.yml` 在指向 `main` 的 PR、`main` 推送时自动执行；另提供供手动发布复用的 `workflow_call`。
- CI 使用 Node.js 22 和 `npm ci`，依次检查工作流安全策略、TypeScript 类型、Vitest、Vite 构建、Manifest 资源和安装 ZIP 完整性。
- CI 只申请 `contents: read`，生成的 ZIP 和 SHA256 校验文件保存在当前 Actions 运行的短期 artifact 中，**不自动创建 GitHub Release**。
- `.github/workflows/release.yml` 仅支持维护者手动触发；需要选择 `main` 并明确勾选 `confirm_publish`。工作流先重新执行完整 CI，验证成功后单独发布任务才获得 `contents: write`。
- 发布使用 `v<版本号>-preview.<提交短 SHA>` 标签。已存在相同标签时直接失败，不覆盖对应 Release。既有 Releases、Git 标签和分支全部保留。

## 手动发布步骤（必须单独授权）

1. 打开 GitHub 仓库的 **Actions** → **LunaTOC-SC manual release**。
2. 点击 **Run workflow**，分支选择 **main**；确认目标提交已完成代码审查。
3. 勾选 **confirm_publish**，再次点击 **Run workflow**。
4. 在运行详情中确认 **Re-run verification before release**、**Publish pre-release** 均成功。
5. 打开 **Releases**，确认新预览版的 ZIP、SHA256 文件和提交号一致。

没有显式批准时不执行以上发布操作。PR 合并后仅触发 CI，不会自动发布。

## 回退与恢复

1. 从 **Releases** 找到之前经过验证的预览版，下载 `luna-toc-sc-chrome.zip` 及其 `.sha256` 文件。
2. 校验 SHA256，再解压到独立文件夹，通过 Chrome 的 **加载已解压的扩展程序** 安装。切换版本前禁用重复安装的扩展，以免两个内容脚本同时运行。
3. 代码回退时应从稳定标签创建新修复分支和 PR，再运行 CI；禁止自动删除历史标签或强制覆盖既有 Release。
4. 扩展代码回退**不等于本地用户数据自动回退**。历史版本与新格式的兼容性必须另行验证；本阶段不修改用户存储键和数据格式。

## 适用范围及未验证项

本阶段只改变构建、发布和项目说明，不修改扩展的业务代码、存储格式或权限。PR CI 通过仅证明自动化检查通过，不代表真实 ChatGPT 浏览器交互已完成验收。


## Branch protection status

**Active and verified on 2026-10-24.** Administrator-created [Ruleset 25771265](https://github.com/PyRookie1/luna-toc-sc/rules/25771265), named `Protect main - Require PR and CI`, targets the default branch `main`. GitHub branch API reports `protected:true` and Rulesets API reports `enforcement: active`.

Rules: PR required (0 approving reviews for this maintainer-owned repository); required GitHub Actions checks `Typecheck, test, build and package` and `Dependency advisory gate`; strict up-to-date checks; no force push or deletion; no bypass actors. The repository's classic branch-protection endpoint is not readable by the connected integration (403), but Ruleset details provide direct positive confirmation.

Do not disable or weaken these protections to force an individual merge; verify PR head SHA and current checks before each merge. A successful PR CI does not authorize publication.
