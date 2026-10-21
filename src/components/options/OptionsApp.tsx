/** Renders supported LunaTOC settings. */
import { useEffect, useState } from 'react';
import {
  loadPlatformRuntimeConfig,
  savePlatformRuntimeConfig,
  type ChatGptRuntimeConfig,
} from '@/config/config';

/** Displays ChatGPT compatibility diagnostics controls. */
export function OptionsApp(): React.JSX.Element {
  const [runtimeConfig, setRuntimeConfig] = useState<ChatGptRuntimeConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = (): void => {
      void loadPlatformRuntimeConfig('chatgpt').then((cfg) => {
        if (!cancelled) setRuntimeConfig(cfg);
      });
    };
    refresh();
    const handleChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (areaName === 'local' && 'luna:chatgpt:runtimeConfig' in changes) refresh();
    };
    chrome.storage.onChanged.addListener(handleChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleChange);
    };
  }, []);

  const toggleCompatibilityAlert = (enabled: boolean): void => {
    setRuntimeConfig((previous) => ({
      useLocalConfig: previous?.useLocalConfig ?? false,
      showCompatibilityAlert: enabled,
    }));
    void savePlatformRuntimeConfig('chatgpt', { showCompatibilityAlert: enabled });
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <header className="mb-8">
        <p className="m-0 text-xs font-semibold tracking-[0.12em] text-[var(--o-accent)] uppercase">LunaTOC-SC</p>
        <h1 className="mt-2 mb-0 text-3xl font-semibold text-[var(--o-text)]">设置</h1>
      </header>
      <section aria-labelledby="compat-heading">
        <h2 id="compat-heading" className="m-0 text-lg font-semibold text-[var(--o-text)]">兼容性</h2>
        <p className="mt-1 mb-4 text-sm text-[var(--o-muted)]">开发者诊断功能，默认关闭。</p>
        <label className="grid cursor-pointer grid-cols-[18px_minmax(0,1fr)] gap-3 rounded-xl border border-[var(--o-border)] bg-[var(--o-surface)] p-4">
          <input type="checkbox" checked={runtimeConfig?.showCompatibilityAlert ?? false}
            onChange={(event) => toggleCompatibilityAlert(event.currentTarget.checked)}
            className="mt-0.5 size-4 accent-[var(--o-accent)]" />
          <span>
            <span className="block text-sm font-semibold text-[var(--o-text)]">ChatGPT 兼容性警告</span>
            <span className="mt-1 block text-sm leading-5 text-[var(--o-muted)]">
              检查会话 API 和关键页面标记；开启后额外发送同源诊断请求并在异常时提醒。
            </span>
          </span>
        </label>
      </section>
    </main>
  );
}
