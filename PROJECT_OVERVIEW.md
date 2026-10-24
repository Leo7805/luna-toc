# LunaTOC-SC — Project Overview

Updated: 2026-10-24. Facts below are based on the current repository files and CI configuration.

## Purpose and users
A Chrome Manifest V3 extension that adds a table of contents/navigation experience to ChatGPT conversations, with prompt management and configurable theme/sidebar presentation.

## Runtime and technology
- Target hosts: `https://chatgpt.com/*` and `https://chat.openai.com/*`.
- Extension platform: Chrome Manifest V3; background service worker and MAIN/ISOLATED content scripts.
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
- 目录别名必须带有账号归属并关联持久会话 ID；无归属的旧别名直接清理，不自动认领。当前仍不信任网页 `postMessage` 删除通知作为清理本地别名的授权，自动跟随远端会话删除的能力待可信确认机制解决。
- 本地 JSON 备份 v2 包含账号绑定的提示词、目录别名、使用统计，以及当前全局主题和侧边栏偏好。设置偏好目前仍是浏览器级全局设置，而不是每个 ChatGPT 账号各自独立的设置。
