# LunaTOC-SC — Project Overview

Updated: 2026-10-24. Facts below are based on the current repository files and CI configuration.

## Purpose and users
A Chrome Manifest V3 extension that adds a table of contents/navigation experience to ChatGPT conversations, with prompt management and configurable theme/sidebar presentation.

## Runtime and technology
- Target hosts: `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Extension platform: Chrome Manifest V3; background service worker and MAIN/ISOLATED content scripts. The extension requests `storage`, `webRequest`, and host access limited to the two ChatGPT origins for confirmed deletion detection.
- Application stack: TypeScript, React, Vite, Tailwind CSS.
- Validation: Vitest unit tests, extension build/package checks, manifest/license/security checks, and headless Chromium tests using mocked ChatGPT HTML/API fixtures.
- CI uses Node.js 22 for project scripts and npm with the committed `package-lock.json`.

## Data and privacy
The extension stores prompts, usage statistics, TOC aliases, theme settings and sidebar preferences in Chrome local storage. The local JSON backup explicitly allowlists those categories and does not export captured conversation bodies, browser credentials, or unknown keys. Backup files can still contain private prompt text and conversation/account identifiers and must be treated as private data.

The current background writer serializes prompt, alias, usage, theme/sidebar and backup operations. Chrome storage does not provide a general transaction; older extension scripts and any future direct storage writers may bypass the queue.

## Build and validation
Run the commands from the repository root:
1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm run test:security`
6. `npm audit --audit-level=high`
7. `npm run test:browser:setup`
8. `npm run test:browser`

See [RUNBOOK.md](RUNBOOK.md) for backup, restore, CI and release operations.

## Release and governance
CI does not publish. The manual release workflow requires choosing `main` and explicitly confirming publication. Historical releases and tags are retained. Rollback of extension code does not automatically roll back local user data.

**Known governance gap:** as of 2026-10-24, `main` branch protection is not enabled. Repository settings must be changed by an administrator; the connected GitHub capability available to this task does not expose a branch-protection write operation. Do not treat PR CI success as a substitute for this configuration.


## 账号数据边界（2026-10-24）

- 我的提示词按可信 ChatGPT 账号 ID 隔离，同一账号的提示词跨对话共享。未知账号不展示提示词且不能写入；无账号归属的旧提示词不迁移，直接清理。
- 目录别名必须带有账号归属并关联持久会话 ID；无归属的旧别名直接清理，不自动认领。真实删除通过后台 `webRequest` 观察器确认成功的 DELETE/非归档可见性移除请求，再经扩展 runtime 通知隔离世界；页面 `postMessage` 不具备删除权限。
- 主题和侧边栏偏好按已验证的 ChatGPT 账号分别保存；设置页支持选择账号。JSON 备份 v3 包含账号绑定的提示词、目录别名、使用统计和各账号偏好，旧 v2 全局设置仅在可识别账号时迁移。
