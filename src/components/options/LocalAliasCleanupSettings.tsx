/** User-driven cleanup for saved conversation aliases; never infers remote deletion. */
import { useEffect, useState } from 'react';
import {
  listLocalTocAliases, requestManualTocAliasCleanup,
  type AliasCleanupCandidate, type AliasCleanupInventory,
} from '@/features/conversationPrompts/aliasCleanup';

const PAGE_SIZE = 20;
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : '未知错误';

export function LocalAliasCleanupSettings(): React.JSX.Element {
  const [inventory, setInventory] = useState<AliasCleanupInventory | null>(null);
  const [shown, setShown] = useState(PAGE_SIZE);
  const [hasBackup, setHasBackup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const refresh = async (): Promise<void> => {
    const next = await listLocalTocAliases();
    setInventory(next);
    setShown(PAGE_SIZE);
  };

  useEffect(() => {
    let active = true;
    void listLocalTocAliases().then((next) => {
      if (active) setInventory(next);
    }).catch((error: unknown) => {
      if (active) setError('无法读取目录记录：' + errorText(error));
    });
    return () => { active = false; };
  }, []);

  const clean = async (item: AliasCleanupCandidate): Promise<void> => {
    if (busy || !hasBackup) return;
    if (!window.confirm(
      '仅清理浏览器本地目录别名，不会删除 ChatGPT 会话。\n' +
      '会话 ID：' + item.routeKey + '\n' +
      '关联账号：' + (item.record.ownerId ?? '旧记录：未绑定账号') + '\n' +
      '别名数量：' + item.aliasCount + '\n\n' +
      '确认已保存可恢复的本地备份，并确定这是不再需要的会话？'
    )) return;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await requestManualTocAliasCleanup(item);
      await refresh();
      setStatus('已清理所选会话的本地目录别名。旧标签页无法重新写入；可通过备份恢复。');
    } catch (cause) {
      setError('清理未完成：' + errorText(cause) +
        '。如果发生存储错误，保护标记可能已写入；请保留备份并刷新列表。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-section" aria-labelledby="alias-cleanup-heading">
      <div className="settings-section-heading">
        <h2 id="alias-cleanup-heading">本地目录记录清理</h2>
        <p>仅检查扩展本地保存的自定义目录名称。无法自动证明 ChatGPT 会话已删除，不会自动清理任何数据。</p>
      </div>
      <div className="settings-card">
        <div className="settings-backup-block">
          <p className="settings-backup-description">
            列表包含本机所有 ChatGPT 账号的记录。请用对应账号打开会话链接确认后再操作。
            清理不会删除 ChatGPT 中的对话，但会设置本地删除保护；通过上方的备份恢复功能可以恢复别名。
          </p>
          <button className="settings-backup-button" type="button" disabled={busy}
            onClick={() => {
              setError('');
              setStatus('');
              setBusy(true);
              void refresh().catch((cause: unknown) => {
                setError('刷新失败：' + errorText(cause));
              }).finally(() => setBusy(false));
            }}>
            刷新本地记录
          </button>
          {inventory && (
            <>
              <p className="settings-backup-description">
                已发现 {inventory.candidates.length} 个含别名的会话记录。
                {inventory.unreadable > 0
                  ? `另有 ${inventory.unreadable} 条格式无法识别的记录，已保留，不会删除。`
                  : ''}
              </p>
              <label className="settings-choice">
                <input type="checkbox" checked={hasBackup} disabled={busy}
                  onChange={(event) => setHasBackup(event.target.checked)} />
                <span>我已在「本地数据备份与恢复」中导出并保存完整备份，了解清理操作可通过备份恢复。</span>
              </label>
              <ul aria-label="待检查的本地目录记录">
                {inventory.candidates.slice(0, shown).map((item) => (
                  <li key={item.routeKey} className="settings-backup-block">
                    <p className="settings-backup-description">
                      <strong>会话：</strong>
                      <a href={`https://chatgpt.com/c/${encodeURIComponent(item.routeKey)}`}
                        target="_blank" rel="noopener noreferrer">{item.routeKey}</a>
                      {' · '}别名 {item.aliasCount} 条
                      {' · '}账号 {item.record.ownerId ?? '未绑定（旧数据）'}
                    </p>
                    <button className="settings-backup-button" type="button"
                      disabled={busy || !hasBackup} onClick={() => void clean(item)}>
                      确认清理此会话的本地别名
                    </button>
                  </li>
                ))}
              </ul>
              {shown < inventory.candidates.length && (
                <button className="settings-backup-button" type="button" disabled={busy}
                  onClick={() => setShown((previous) => previous + PAGE_SIZE)}>
                  显示更多记录
                </button>
              )}
            </>
          )}
          {status && <p role="status" className="settings-backup-status">{status}</p>}
          {error && <p role="alert" className="settings-error">{error}</p>}
        </div>
      </div>
    </section>
  );
}
