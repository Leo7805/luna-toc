# Plan 2: sessionStorage 助手统一

## 思路

`storageGet<T>(key)` / `storageSet(key, value)` 这对 `sessionStorage` 包装在三处重复(且与原 `applicationShell.ts` 内 inline 版本字节级相同,只是局部变量名 `value` vs `rawValue` 不同):

- [`src/features/jumpControls/jumpControls.ts`](src/features/jumpControls/jumpControls.ts) — Plan 1 batch 1 引入
- [`src/features/toggleButton.ts`](src/features/toggleButton.ts) — 原有
- [`src/features/sidebarVisibility.ts`](src/features/sidebarVisibility.ts) — 原有

行为完全一致:`try { ... } catch { return null }` 吞 JSON 解析错误,`try { ... } catch {}` 吞写入错误。统一成 [`src/lib/sessionStorage.ts`](src/lib/sessionStorage.ts) 一份实现,各调用点改 import。

`applicationShell.ts` 原有的 inline 版本已在 Plan 1 batch 1 删除,无需清理。

## TODO 大纲

- [ ] 1. 新建 `src/lib/sessionStorage.ts` 导出 `storageGet<T>` / `storageSet`
- [ ] 2. `jumpControls.ts` 改 import + 删除本地实现
- [ ] 3. `toggleButton.ts` 改 import + 删除本地实现
- [ ] 4. `sidebarVisibility.ts` 改 import + 删除本地实现
- [ ] 5. 验证构建与功能

## 跨 Plan 约定

- 文件大小目标 100-300 行,硬上限 500 行(per [`TEMPLATE_Common.md` File Size](~/Projects/ai-agent-rules/TEMPLATE_Common.md))
- 新文件首次进入 import 图 → 必跑完整 `pnpm sbuild`(不是只 typecheck),然后 `chrome://extensions` 重载(详见 [chrome-extension-stale-build-diagnosis](.claude/projects/-Users-leo-Projects-chrome-plugins-luna-toc/memory/chrome-extension-stale-build-diagnosis.md))
- Plan 1 必须先完成(Plan 2 改动 `jumpControls.ts`,需要 Plan 1 batch 2-4 已完成,jumpControls.ts 内部结构稳定)

## 改动清单

- 新增 [`src/lib/sessionStorage.ts`](src/lib/sessionStorage.ts)(~15 行)
  - `storageGet<T>(key: string): T | null` — `sessionStorage.getItem` + `JSON.parse`,try/catch 吞错
  - `storageSet(key: string, value: unknown): void` — `JSON.stringify` + `sessionStorage.setItem`,try/catch 吞错
  - 签名与现有三处完全一致,纯 drop-in 替换
- 修改 [`src/features/jumpControls/jumpControls.ts`](src/features/jumpControls/jumpControls.ts)
  - 新增:`import { storageGet, storageSet } from '@/lib/sessionStorage';`
  - 删除:本地 `storageGet<T>` / `storageSet` 实现
- 修改 [`src/features/toggleButton.ts`](src/features/toggleButton.ts)
  - 新增:`import { storageGet, storageSet } from '@/lib/sessionStorage';`
  - 删除:本地 `storageGet<T>` / `storageSet` 实现
- 修改 [`src/features/sidebarVisibility.ts`](src/features/sidebarVisibility.ts)
  - 新增:`import { storageGet, storageSet } from '@/lib/sessionStorage';`
  - 删除:本地 `storageGet<T>` / `storageSet` 实现

## 步骤

- [ ] 1. 新建 [`src/lib/sessionStorage.ts`](src/lib/sessionStorage.ts),导出 `storageGet<T>(key)` 和 `storageSet(key, value)`,body 与现有三份等价(用 `rawValue` 变量名以保持与 `toggleButton.ts` / `sidebarVisibility.ts` 一致)
- [ ] 2. 改 `jumpControls.ts` import,删除本地实现
- [ ] 3. 改 `toggleButton.ts` import,删除本地实现
- [ ] 4. 改 `sidebarVisibility.ts` import,删除本地实现
- [ ] 5. 用 `grep -r "function storageGet\|function storageSet" src/` 确认全代码库仅剩 `src/lib/sessionStorage.ts` 一处定义

## 验证

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm sbuild` 完整构建(新增 `src/lib/sessionStorage.ts`,新文件进入 import 图)
- [ ] `pnpm test` 全过
- [ ] Chrome 手动冒烟(以下行为必须不变):
  - [ ] 拖动 toggle button → 位置保存 → 刷新恢复
  - [ ] 拖动 jump-controls → 比例保存 → 刷新恢复
  - [ ] 点 pin button → 状态保存 → 刷新恢复
  - [ ] sidebar 自动隐藏行为正常
  - [ ] DevTools → Application → Session Storage,三个 key 仍能读写,值结构不变

## 风险

- **新文件进入 import 图**:Plan B 新建 `src/lib/sessionStorage.ts`,3 个现有文件加 import。按 stale-build 记忆必须 `pnpm sbuild` 后 `chrome://extensions` 重载
- **行为完全等价保证**:三份现有实现的差异只在变量名(`value` vs `rawValue`),JSON 解析 / 写入 / 错误吞没行为一致。若 `pnpm sbuild` 通过 + `pnpm test` 通过 + 手动验证位置/状态恢复,即可视为等价
- **Plan 1 与 Plan 2 顺序**:Plan 1 先,Plan 2 后。Plan 2 修改 `jumpControls.ts` 时,Plan 1 batch 2-4 已完成,jumpControls.ts 内部结构稳定,改动面更小

## Plan 2 暂不处理(后续统一 PR,刻意避开)

- 提取 conversation-id 正则解析助手(`applicationShell.ts`、`navigatorController.ts`、`sidebarVisibility.ts` 三处重复)
- 统一 `applicationShell.ts` 与 `content.ts` 重复的 `waitForBody`(Plan 1 batch 2 已搬到 sidebarView.ts,只剩 content.ts 内的副本)
- 引入 viewport-clamp 共享助手(jumpControls 与 toggleButton 拖拽实现差异过大)
- jumpControls 缺少 `dataset.dragged` 标志位(已知潜在缺陷)