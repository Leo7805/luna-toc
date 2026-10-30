/** Renders the sidebar startup preference in the full Settings page. */
import { useEffect, useState } from 'react';
import {
  DEFAULT_SIDEBAR_PINNED_ON_STARTUP,
  readSidebarPinnedOnStartup,
  subscribeSidebarPinnedOnStartup,
  writeSidebarPinnedOnStartup,
} from '@/features/sidebar/sidebarSettings';

/** Lets users choose the pin state used for new ChatGPT tab sessions. */
export function SidebarSettings(): React.JSX.Element {
  const [pinned, setPinned] = useState(DEFAULT_SIDEBAR_PINNED_ON_STARTUP);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;
    let hasLiveUpdate = false;
    const unsubscribe = subscribeSidebarPinnedOnStartup((value) => {
      hasLiveUpdate = true;
      if (isMounted) {
        setPinned(value);
        setIsLoaded(true);
      }
    });
    void readSidebarPinnedOnStartup().then((value) => {
      if (!isMounted) return;
      if (!hasLiveUpdate) setPinned(value);
      setIsLoaded(true);
    });
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  /** Saves the selection and keeps the last saved value if storage rejects it. */
  const updatePinned = async (nextPinned: boolean): Promise<void> => {
    setIsSaving(true);
    setError('');
    try {
      await writeSidebarPinnedOnStartup(nextPinned);
      setPinned(nextPinned);
    } catch {
      setError('Could not save the sidebar preference. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mb-8" aria-labelledby="sidebar-settings-heading">
      <h2 id="sidebar-settings-heading" className="m-0 text-lg font-semibold text-[var(--o-text)]">
        Sidebar
      </h2>
      <div className="mt-4 rounded-xl border border-[var(--o-border)] bg-[var(--o-surface)] p-4">
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-semibold text-[var(--o-text)]">
              Pin sidebar on startup
            </span>
            <span id="sidebar-startup-description" className="mt-1 block text-xs text-[var(--o-muted)]">
              Start new ChatGPT tab sessions with the sidebar pinned open. Turn off to start collapsed with auto-hide enabled.
            </span>
          </span>
          <span className="relative inline-flex shrink-0">
            <input
              type="checkbox"
              role="switch"
              aria-label="Pin sidebar on startup"
              checked={pinned}
              disabled={!isLoaded || isSaving}
              onChange={(event) => void updatePinned(event.target.checked)}
              aria-describedby="sidebar-startup-description"
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="h-5 w-9 cursor-pointer rounded-full border border-[var(--o-border)] bg-[var(--o-muted)]/30 transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:border-[var(--o-accent)] peer-checked:bg-[var(--o-accent)] peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--o-accent)] peer-focus-visible:ring-offset-2 peer-disabled:cursor-wait peer-disabled:opacity-50"
            />
          </span>
        </label>
        <p className="mt-3 mb-0 text-xs text-[var(--o-muted)]">
          Applies to new tab sessions. Refreshing preserves the current tab’s pin state.
        </p>
        {error && <p role="alert" className="mt-3 mb-0 text-sm text-[var(--o-text)]">{error}</p>}
      </div>
    </section>
  );
}
