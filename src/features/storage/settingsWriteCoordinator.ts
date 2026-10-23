/** Validated background writer for theme and sidebar settings. */
import type { SidebarPreferences } from '@/features/sidebar/sidebarPreferences';
import type { ThemeSettings } from '@/features/theme/themeSettings';
import { createSerialWriteQueue, type SerialWriteQueue } from './serialWriteQueue';

export const SETTINGS_COMMIT_TYPE = 'LUNA_TOC_SETTINGS_COMMIT_V1';
const THEME_KEY = 'chatToc:themeSettings';
const LEGACY_THEME_KEY = 'chatToc:theme';
const SIDEBAR_KEY = 'chatToc:sidebarPreferences';
const SIDEBAR_COLOR_IDS = new Set(['default', 'blue', 'green', 'yellow', 'pink', 'orange', 'purple', 'red', 'cyan', 'lime', 'magenta']);
export type SettingsCommitRequest =
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'theme'; settings: ThemeSettings; removeLegacy?: boolean }
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'sidebar'; settings: SidebarPreferences };
export type SettingsCommitResponse = { ok: true } | { ok: false; error: string };
type Storage = Pick<chrome.storage.StorageArea, 'set' | 'remove'>;

function isTheme(value: unknown): value is ThemeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.followChatGPT === 'boolean' &&
    (item.manualTheme === 'dark' || item.manualTheme === 'light');
}
function isSidebar(value: unknown): value is SidebarPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.layoutMode === 'overlay' || item.layoutMode === 'side-by-side') &&
    typeof item.backgroundColor === 'string' && SIDEBAR_COLOR_IDS.has(item.backgroundColor) &&
    typeof item.revealTint === 'boolean';
}
function isRequest(value: unknown): value is SettingsCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type !== SETTINGS_COMMIT_TYPE) return false;
  if (item.action === 'theme') return isTheme(item.settings) &&
    (item.removeLegacy === undefined || typeof item.removeLegacy === 'boolean');
  return item.action === 'sidebar' && isSidebar(item.settings);
}
export function createSettingsWriteCoordinator(
  storage: Storage = chrome.storage.local,
  queue: SerialWriteQueue = createSerialWriteQueue()
): { commit(request: unknown): Promise<SettingsCommitResponse> } {
  return { commit(request: unknown): Promise<SettingsCommitResponse> {
    return queue.run(async () => {
      if (!isRequest(request)) return { ok: false, error: 'Invalid settings update request' };
      try {
        if (request.action === 'theme') {
          await storage.set({ [THEME_KEY]: request.settings });
          if (request.removeLegacy) await storage.remove(LEGACY_THEME_KEY).catch(() => undefined);
        } else {
          await storage.set({ [SIDEBAR_KEY]: request.settings });
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Settings storage write failed' };
      }
    });
  } };
}
