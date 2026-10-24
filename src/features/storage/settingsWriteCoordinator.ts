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
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'migrate-theme'; settings: ThemeSettings }
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'cleanup-legacy-theme' }
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'sidebar'; settings: SidebarPreferences }
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'sidebar-patch'; patch: Partial<SidebarPreferences>; expected: Partial<SidebarPreferences> };
export type SettingsCommitResponse = { ok: true } | { ok: false; conflict: true } | { ok: false; error: string };
type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

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
function isSidebarPatch(value: unknown): value is Partial<SidebarPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const patch = value as Record<string, unknown>;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) =>
    key !== 'layoutMode' && key !== 'backgroundColor' && key !== 'revealTint')) return false;
  return (!Object.hasOwn(patch, 'layoutMode') ||
      patch.layoutMode === 'overlay' || patch.layoutMode === 'side-by-side') &&
    (!Object.hasOwn(patch, 'backgroundColor') ||
      (typeof patch.backgroundColor === 'string' && SIDEBAR_COLOR_IDS.has(patch.backgroundColor))) &&
    (!Object.hasOwn(patch, 'revealTint') || typeof patch.revealTint === 'boolean');
}

function isRequest(value: unknown): value is SettingsCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type !== SETTINGS_COMMIT_TYPE) return false;
  if (item.action === 'theme') return isTheme(item.settings) &&
    (item.removeLegacy === undefined || typeof item.removeLegacy === 'boolean');
  if (item.action === 'migrate-theme') return isTheme(item.settings);
  if (item.action === 'cleanup-legacy-theme') return true;
  if (item.action === 'sidebar') return isSidebar(item.settings);
  if (item.action !== 'sidebar-patch' || !isSidebarPatch(item.patch) ||
      !isSidebarPatch(item.expected)) return false;
  const patchKeys = Object.keys(item.patch);
  const expectedKeys = Object.keys(item.expected as object);
  return patchKeys.length === expectedKeys.length &&
    patchKeys.every((key) => Object.hasOwn(item.expected as object, key));
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
        } else if (request.action === 'migrate-theme') {
          // Migration was initiated from a read that may predate a queued backup restore.
          // Preserve any valid setting that was committed while the migration waited.
          const current = await storage.get(THEME_KEY);
          if (!isTheme(current[THEME_KEY])) await storage.set({ [THEME_KEY]: request.settings });
          await storage.remove(LEGACY_THEME_KEY).catch(() => undefined);
        } else if (request.action === 'cleanup-legacy-theme') {
          await storage.remove(LEGACY_THEME_KEY).catch(() => undefined);
        } else if (request.action === 'sidebar-patch') {
          // A field patch must merge with the latest persisted state inside the
          // shared worker queue; never write a stale options-page snapshot.
          const values = await storage.get(SIDEBAR_KEY);
          const baseline: SidebarPreferences = isSidebar(values[SIDEBAR_KEY])
            ? values[SIDEBAR_KEY]
            : { layoutMode: 'overlay', backgroundColor: 'default', revealTint: false };
          // The same-field comparison and storage write run in one worker
          // queue task, so a stale tab cannot silently overwrite a newer edit.
          for (const key of Object.keys(request.patch) as Array<keyof SidebarPreferences>) {
            if (baseline[key] !== request.expected[key]) return { ok: false, conflict: true };
          }
          const merged = { ...baseline, ...request.patch };
          await storage.set({ [SIDEBAR_KEY]: merged });
        } else {
          // Older settings pages only know full-record writes and cannot
          // express user intent or a comparison baseline. Do not permit them
          // to overwrite valid saved state; the user must reload the page.
          const values = await storage.get(SIDEBAR_KEY);
          const existing = values[SIDEBAR_KEY];
          if (isSidebar(existing)) {
            if (existing.layoutMode !== request.settings.layoutMode ||
                existing.backgroundColor !== request.settings.backgroundColor ||
                existing.revealTint !== request.settings.revealTint) {
              return { ok: false, conflict: true };
            }
          } else {
            await storage.set({ [SIDEBAR_KEY]: request.settings });
          }
        }
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Settings storage write failed' };
      }
    });
  } };
}
