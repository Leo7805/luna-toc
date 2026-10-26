/** Renders LunaTOC preferences using ChatGPT-like settings groups. */
import { useEffect, useRef, useState } from 'react';
import { LocalBackupSettings } from './LocalBackupSettings';
import { LocalAliasCleanupSettings } from './LocalAliasCleanupSettings';
import {
  loadPlatformRuntimeConfig,
  savePlatformRuntimeConfig,
  type ChatGptRuntimeConfig,
} from '@/config/config';
import {
  ACCOUNT_EMAILS_KEY, ACCOUNT_SETTINGS_KEY, accountSettingsEmails, accountSettingsOwners,
} from '@/features/storage/accountSettings';
import {
  DEFAULT_SIDEBAR_PREFERENCES,
  SIDEBAR_COLORS,
  readSidebarPreferences,
  subscribeSidebarPreferences,
  writeSidebarPreferences,
  type SidebarPreferences,
  type SidebarLayoutMode,
} from '@/features/sidebar/sidebarPreferences';

/** Displays layout, appearance and advanced compatibility settings. */
export function OptionsApp(): React.JSX.Element {
  const [runtimeConfig, setRuntimeConfig] = useState<ChatGptRuntimeConfig | null>(null);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [accountEmails, setAccountEmails] = useState<Record<string, string>>({});
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [preferences, setPreferences] = useState<SidebarPreferences>(
    DEFAULT_SIDEBAR_PREFERENCES
  );
  const [saveError, setSaveError] = useState('');
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const pendingSidebarWrite = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const refreshRuntimeConfig = (): void => {
      void loadPlatformRuntimeConfig('chatgpt').then((cfg) => {
        if (!cancelled) setRuntimeConfig(cfg);
      });
    };
    const refreshAccounts = async (): Promise<void> => {
      const values = await chrome.storage.local.get([ACCOUNT_SETTINGS_KEY, ACCOUNT_EMAILS_KEY]);
      if (cancelled) return;
      const next = accountSettingsOwners(values[ACCOUNT_SETTINGS_KEY]);
      setAccountEmails(accountSettingsEmails(values[ACCOUNT_EMAILS_KEY]));
      setAccountIds(next);
      setSelectedAccountId((current) => next.includes(current) ? current : next[0] ?? '');
    };
    refreshRuntimeConfig();
    void refreshAccounts().catch(() => {
      if (!cancelled) setSaveError('无法读取账号设置列表，请检查扩展存储权限。');
    });
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (areaName !== 'local') return;
      if ('luna:chatgpt:runtimeConfig' in changes) refreshRuntimeConfig();
      if (ACCOUNT_SETTINGS_KEY in changes || ACCOUNT_EMAILS_KEY in changes) {
        void refreshAccounts().catch(() => {
          if (!cancelled) setSaveError('无法刷新账号设置列表。');
        });
      }
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!selectedAccountId) {
      setSettingsLoaded(false);
      setPreferences({ ...DEFAULT_SIDEBAR_PREFERENCES });
      return;
    }
    setSettingsLoaded(false);
    void readSidebarPreferences(selectedAccountId).then((values) => {
      if (!cancelled) {
        setPreferences(values);
        setSettingsLoaded(true);
      }
    }).catch(() => {
      if (!cancelled) setSaveError('无法读取所选账号的设置，请检查扩展存储权限。');
    });
    const unsubscribe = subscribeSidebarPreferences((next) => {
      if (!cancelled) setPreferences(next);
    }, selectedAccountId);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [selectedAccountId]);

  /** Save changed fields while preventing duplicate UI submissions. */
  const updatePreferences = (patch: Partial<SidebarPreferences>): void => {
    // Prevent two fast clicks from triggering overlapping saves.
    if (!selectedAccountId || !settingsLoaded || pendingSidebarWrite.current) return;
    pendingSidebarWrite.current = true;
    setSavingSettings(true);
    setPreferences((previous) => ({ ...previous, ...patch }));
    setSaveError('');
    void writeSidebarPreferences(patch, selectedAccountId).catch(() => {
      setSaveError('设置保存失败，当前操作未保存；请检查存储状态并重试。');
    }).then(async () => {
      try {
        setPreferences(await readSidebarPreferences(selectedAccountId));
      } catch {
        setSaveError('无法读取最新设置，请重新打开设置页面后再修改。');
      }
    }).finally(() => {
      pendingSidebarWrite.current = false;
      setSavingSettings(false);
    });
  };

  const toggleCompatibilityAlert = (enabled: boolean): void => {
    setRuntimeConfig((previous) => ({
      useLocalConfig: previous?.useLocalConfig ?? false,
      showCompatibilityAlert: enabled,
    }));
    void savePlatformRuntimeConfig('chatgpt', { showCompatibilityAlert: enabled });
  };

  const modeOptions: Array<{ id: SidebarLayoutMode; name: string; detail: string }> = [
    { id: 'side-by-side', name: '并列排布', detail: '对话区域与目录并排，默认固定展开' },
    { id: 'overlay', name: '浮于上层', detail: '不改变对话区域，目录默认自动隐藏' },
  ];

  return (
    <main className="settings-page">
      <header className="settings-header">
        <p className="settings-brand">LunaTOC-SC</p>
        <h1>设置</h1>
        <p className="settings-caption">偏好设置会自动同步到已打开的 ChatGPT 页面。</p>
      </header>

      <section className="settings-section" aria-labelledby="account-settings-heading">
        <div className="settings-section-heading">
          <h2 id="account-settings-heading">账号偏好</h2>
          <p>主题与侧边栏设置按 ChatGPT 账号保存，并在该账号的所有对话中共享。</p>
        </div>
        <div className="settings-card">
          <label className="settings-choice settings-no-border">
            <span className="settings-choice-info">
              <strong>设置所属账号</strong>
              <small>账号标识仅用于区分本地设置，不会上传。</small>
            </span>
            <select className="settings-account-select" aria-label="设置所属账号"
              value={selectedAccountId}
              disabled={accountIds.length === 0 || savingSettings}
              onChange={(event) => setSelectedAccountId(event.currentTarget.value)}>
              {accountIds.map((id) => (
                <option key={id} value={id}>
                  {accountEmails[id] ?? `账号 ${id.slice(0, 6)}…${id.slice(-4)}`}
                </option>
              ))}
            </select>
          </label>
          {accountIds.length === 0 && (
            <p className="settings-backup-status" role="status">
              尚无已验证账号。请先打开并登录 ChatGPT，等待页面完成初始化后重新打开此设置页。
            </p>
          )}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="layout-heading">
        <div className="settings-section-heading">
          <h2 id="layout-heading">布局</h2>
          <p>选择对话和目录的排列方式。</p>
        </div>
        <div className="settings-card settings-layout-choice">
          {modeOptions.map((mode) => (
            <label className="settings-choice" key={mode.id}>
              <span className="settings-choice-info">
                <strong>{mode.name}</strong>
                <small>{mode.detail}</small>
              </span>
              <input type="radio" name="sidebar-layout" value={mode.id}
                checked={preferences.layoutMode === mode.id}
                disabled={!settingsLoaded || savingSettings}
                onChange={() => updatePreferences({ layoutMode: mode.id })} />
            </label>
          ))}
        </div>
      </section>

      <section className="settings-section" aria-labelledby="appearance-heading">
        <div className="settings-section-heading">
          <h2 id="appearance-heading">外观</h2>
          <p>选择 LunaTOC 的背景配色，与 ChatGPT 浅色和深色主题协调。</p>
        </div>
        <div className="settings-card">
          <div className="settings-setting-title">侧边栏背景颜色</div>
          <div className="settings-palette" role="radiogroup" aria-label="侧边栏背景颜色">
            {SIDEBAR_COLORS.map((color) => (
              <label className="settings-swatch-label" key={color.id}
                title={color.label} aria-label={color.label}>
                <input type="radio" name="sidebar-color" value={color.id}
                  checked={preferences.backgroundColor === color.id}
                  disabled={!settingsLoaded || savingSettings}
                  onChange={() => updatePreferences({ backgroundColor: color.id })} />
                <span className="settings-swatch" style={{ backgroundColor: color.hex }}
                  aria-hidden="true">
                  {preferences.backgroundColor === color.id ? '✓' : ''}
                </span>
                <span className="settings-swatch-text">{color.label}</span>
              </label>
            ))}
          </div>
          <div className="settings-divider" />
          <label className="settings-choice settings-no-border">
            <span className="settings-choice-info">
              <strong>为隐藏侧边栏的触发区显示颜色</strong>
              <small>开启时与背景所选色系一致，使用半透明显示；关闭则完全透明。</small>
            </span>
            <input className="settings-switch-input" type="checkbox"
              checked={preferences.revealTint}
              disabled={!settingsLoaded || savingSettings}
              onChange={(event) => updatePreferences({ revealTint: event.target.checked })} />
            <span className="settings-switch-track" aria-hidden="true" />
          </label>
        </div>
      </section>

      <section className="settings-section" aria-labelledby="compat-heading">
        <div className="settings-section-heading">
          <h2 id="compat-heading">兼容性</h2>
          <p>开发者诊断功能，默认关闭。</p>
        </div>
        <div className="settings-card">
          <label className="settings-choice settings-no-border">
            <span className="settings-choice-info">
              <strong>ChatGPT 兼容性警告</strong>
              <small>检查会话 API 和关键页面标记；开启后可能发送额外的同源诊断请求。</small>
            </span>
            <input className="settings-switch-input" type="checkbox"
              checked={runtimeConfig?.showCompatibilityAlert ?? false}
              onChange={(event) => toggleCompatibilityAlert(event.target.checked)} />
            <span className="settings-switch-track" aria-hidden="true" />
          </label>
        </div>
      </section>
      <LocalBackupSettings />
      <LocalAliasCleanupSettings />
      {savingSettings && <p className="settings-backup-status" role="status">正在保存侧边栏设置…</p>}
      {saveError && <p className="settings-error" role="alert">{saveError}</p>}
      <p className="settings-footnote">设置保存在浏览器本地，不会上传到维护者服务器。</p>
    </main>
  );
}
