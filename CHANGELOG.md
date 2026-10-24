## Unreleased

- 历史提问编辑提交成功后立即刷新当前活动分支；若首个快照早于分支切换，仅在生成流结束后补偿重试一次，并保持普通尾部提问不触发额外刷新。
- 修复部分 ChatGPT 回答将完整 `**粗体文本**` 标记原样显示的问题；只处理助手 Markdown 中安全的完整标记，跳过代码、数学公式及不完整标记。
- 修复目录标题跳转与顶部/底部按钮抢夺滚动位置的问题：启动边缘跳转前取消旧标题跳转的重试与下一帧校正。
- 将主题与侧边栏偏好按已验证的 ChatGPT 账号隔离，设置页提供账号选择；本地备份 v3 按账号导入导出，并兼容可识别账号的 v2 备份。
- 由扩展后台使用受限的 `webRequest` 观察器确认真实 DELETE/非归档可见性移除请求成功，再向原标签页发送可信 runtime 通知；忽略可伪造的页面删除消息和含糊的 GET 404/410。

- 将提示词库按已验证的 ChatGPT 账号隔离；清空提示词仅影响当前账号，并清理未绑定账号的旧提示词与孤立使用统计。
- 要求新目录别名具有账号归属，清理未绑定账号的旧别名；保留账户校验、会话删除标记、后台共享写入队列及数据恢复保护。
- 上一阶段将本地 JSON 备份格式升级至 v2，要求提示词和目录别名绑定账号；当前版本再升级至 v3，将主题与侧边栏偏好按账号导入导出，并拒绝跨账号 ID 冲突。
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
- B026: page-originated deletion messages remain untrusted; D30 adds a narrowly scoped background `webRequest` observer to restore automatic cleanup only after an actual deletion-class mutation returns 2xx.
- Upgrade GitHub Actions dependencies to currently supported major versions (checkout v7, setup-node v7, upload-artifact v7, download-artifact v8).
- Repository administrator activated and verified an enforced `main` Ruleset (required PR and two up-to-date CI checks; no force push, deletion or bypass); the connected GitHub capability did not alter settings.

Validation status: pending the CI run for the Stage 10 branch. Synthetic browser timing is not live ChatGPT performance evidence.
