## Unreleased

- 将提示词库按已验证的 ChatGPT 账号隔离；清空提示词仅影响当前账号，并清理未绑定账号的旧提示词与孤立使用统计。
- 要求新目录别名具有账号归属，清理未绑定账号的旧别名；保留账户校验、会话删除标记、后台共享写入队列及数据恢复保护。
- 本地 JSON 备份格式升级至 v2，提示词和目录别名必须绑定账号；继续包含主题与侧边栏偏好，并拒绝跨账号 ID 冲突。
- 移除提示词整表保存 API 和侧边栏设置全量写入分支，保留字段补丁与备份恢复回滚。

# Changelog

## Unreleased — Stage 11 data integrity and account isolation

- Resolve account identity through an isolated-world same-origin session request, never from page-originated identity messages.
- Hide account-bound TOC aliases unless the active account matches, retain legacy unowned entries in storage and backups instead of deleting them.
- Validate imported TOC message identifiers with the same rules as normal storage writes, rejecting reserved object keys before restoration.
- Clear all prompts and usage statistics through one queued background operation with storage verification and compensating rollback.
- Reject delayed usage increments for prompts that no longer exist after a clear.
- Add unit and Chromium fixture regressions for account spoofing, cross-account visibility, invalid backup IDs, concurrent clearing, and interrupted writes.
- Real authenticated ChatGPT and mixed-version tabs remain outside automated fixture coverage. No automatic release.

Notable user-facing changes are recorded here. This project does not publish automatically from CI.

## Unreleased — Stage 10 reliability hardening

- Serialize current-version extension writes for prompts, TOC aliases, prompt usage, theme and sidebar preferences through one background queue shared with backup export/restore.
- Move prompt usage increments and reconciliation to a read-modify-write coordinator to prevent lost increments between tabs.
- Check estimated Chrome local-storage capacity before restoring a backup; reject over-quota restores before mutating data.
- Add unit tests for shared queue ordering, usage counter concurrency, settings validation and restore capacity.
- Distinguish mounted and virtualized 500-message Chromium jump fixtures, with assertions against the actual chat scroll viewport.
- Filter stale orphan usage from read-only backups and reconcile it on merge restore while rejecting malformed imported files.
- Make post-restore storage verification insensitive to JSON object-key ordering, without relaxing value or deletion-fence checks.
- B026: ignore untrusted MAIN-world deletion events in the isolated lifecycle listener to prevent local alias deletion; automatic cleanup after real ChatGPT deletion is temporarily disabled and documented.
- Upgrade GitHub Actions dependencies to currently supported major versions (checkout v7, setup-node v7, upload-artifact v7, download-artifact v8).
- Repository administrator activated and verified an enforced `main` Ruleset (required PR and two up-to-date CI checks; no force push, deletion or bypass); the connected GitHub capability did not alter settings.

Validation status: pending the CI run for the Stage 10 branch. Synthetic browser timing is not live ChatGPT performance evidence.
