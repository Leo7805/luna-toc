/** Validated, account-scoped preference writes in the MV3 background worker. */
import type { SidebarPreferences } from '@/features/sidebar/sidebarPreferences';
import type { ThemeSettings } from '@/features/theme/themeSettings';
import { createSerialWriteQueue, type SerialWriteQueue } from './serialWriteQueue';
import {
  ACCOUNT_EMAILS_KEY,
  ACCOUNT_SETTINGS_KEY,
  isValidAccountOwnerId,
  isValidAccountEmail,
  type AccountSettingsMap,
  type AccountSettingsRecord,
} from './accountSettings';

export const SETTINGS_COMMIT_TYPE = 'LUNA_TOC_SETTINGS_COMMIT_V2';
const MIGRATION_KEY = 'chatToc:accountSettings:migrated:v1';
const LEGACY_THEME_SETTINGS_KEY = 'chatToc:themeSettings';
const LEGACY_THEME_KEY = 'chatToc:theme';
const LEGACY_SIDEBAR_KEY = 'chatToc:sidebarPreferences';
const PROMPTS_KEY = 'lumaToc:myPromptsV1';
const ALIAS_PREFIX = 'chatToc:aliases:v1:';
const DEFAULT_THEME: ThemeSettings = { followChatGPT: true, manualTheme: 'dark' };
const DEFAULT_SIDEBAR: SidebarPreferences = {
  layoutMode: 'overlay', backgroundColor: 'default', revealTint: false,
};
const SIDEBAR_COLOR_IDS = new Set([
  'default', 'blue', 'green', 'yellow', 'pink', 'orange', 'purple', 'red',
  'cyan', 'lime', 'magenta',
]);

export type SettingsCommitRequest =
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'register-account'; ownerId: string; email?: string }
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'theme'; ownerId: string; settings: ThemeSettings }
  | { type: typeof SETTINGS_COMMIT_TYPE; action: 'sidebar-patch'; ownerId: string; patch: Partial<SidebarPreferences> };
export type SettingsCommitResponse = { ok: true } | { ok: false; error: string };
type Storage = Pick<chrome.storage.StorageArea, 'get' | 'set' | 'remove'>;

function isTheme(value: unknown): value is ThemeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 2 &&
    typeof item.followChatGPT === 'boolean' &&
    (item.manualTheme === 'dark' || item.manualTheme === 'light');
}
function isSidebar(value: unknown): value is SidebarPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 3 &&
    (item.layoutMode === 'overlay' || item.layoutMode === 'side-by-side') &&
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
function isAccountSettingsRecord(value: unknown): value is AccountSettingsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).length === 2 && isTheme(item.theme) && isSidebar(item.sidebar);
}
function readSettingsMap(value: unknown): AccountSettingsMap {
  if (value === undefined) return Object.create(null) as AccountSettingsMap;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('账号设置存储格式无效，已拒绝覆盖。');
  }
  const result = Object.create(null) as AccountSettingsMap;
  for (const [ownerId, record] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidAccountOwnerId(ownerId) || !isAccountSettingsRecord(record)) {
      throw new Error('账号设置包含无效记录，已拒绝覆盖。');
    }
    result[ownerId] = { theme: { ...record.theme }, sidebar: { ...record.sidebar } };
  }
  return result;
}

function readAccountEmails(value: unknown): Record<string, string> {
  if (value === undefined) return Object.create(null) as Record<string, string>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('账号邮箱存储格式无效，已拒绝覆盖。');
  }
  const result = Object.create(null) as Record<string, string>;
  for (const [ownerId, email] of Object.entries(value as Record<string, unknown>)) {
    if (!isValidAccountOwnerId(ownerId) || !isValidAccountEmail(email)) {
      throw new Error('账号邮箱包含无效记录，已拒绝覆盖。');
    }
    result[ownerId] = email;
  }
  return result;
}
function isRequest(value: unknown): value is SettingsCommitRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (item.type !== SETTINGS_COMMIT_TYPE || !isValidAccountOwnerId(item.ownerId)) return false;
  if (item.action === 'register-account') {
    return !Object.hasOwn(item, 'email') || isValidAccountEmail(item.email);
  }
  if (item.action === 'theme') return isTheme(item.settings);
  return item.action === 'sidebar-patch' && isSidebarPatch(item.patch);
}
function equalStorageValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null ||
      typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => equalStorageValue(item, right[index]));
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equalStorageValue(a[key], b[key]));
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '本地存储错误';
}
async function persistVerified(
  storage: Storage,
  original: Record<string, unknown>,
  values: Record<string, unknown>,
  label: string
): Promise<SettingsCommitResponse> {
  const keys = Object.keys(values);
  try {
    await storage.set(values);
    const actual = await storage.get(keys);
    if (keys.some((key) => !equalStorageValue(values[key], actual[key]))) {
      throw new Error('写入后核验不一致');
    }
    return { ok: true };
  } catch (failure) {
    try {
      const previous: Record<string, unknown> = {};
      for (const key of keys) if (Object.hasOwn(original, key)) previous[key] = original[key];
      if (Object.keys(previous).length) await storage.set(previous);
      const absent = keys.filter((key) => !Object.hasOwn(original, key));
      if (absent.length) await storage.remove(absent);
      const restored = await storage.get(keys);
      if (keys.some((key) => !equalStorageValue(restored[key], original[key]))) {
        throw new Error('回滚核验不一致');
      }
    } catch {
      return { ok: false, error: label + '失败，自动回滚也失败；请先导出备份并停止继续修改设置。' };
    }
    return { ok: false, error: label + '失败，原有设置已恢复：' + errorText(failure) };
  }
}
function legacyTheme(all: Record<string, unknown>): ThemeSettings {
  const current = all[LEGACY_THEME_SETTINGS_KEY];
  if (isTheme(current)) return { ...current };
  const old = all[LEGACY_THEME_KEY];
  if (old === 'dark' || old === 'light') return { followChatGPT: false, manualTheme: old };
  return { ...DEFAULT_THEME };
}
function legacySidebar(all: Record<string, unknown>): SidebarPreferences {
  const value = all[LEGACY_SIDEBAR_KEY];
  return isSidebar(value) ? { ...value } : { ...DEFAULT_SIDEBAR };
}
function collectKnownOwners(all: Record<string, unknown>, activeOwner: string): Set<string> {
  const owners = new Set<string>([activeOwner]);
  const prompts = all[PROMPTS_KEY];
  if (Array.isArray(prompts)) {
    for (const item of prompts) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const ownerId = (item as Record<string, unknown>).ownerId;
        if (isValidAccountOwnerId(ownerId)) owners.add(ownerId);
      }
    }
  }
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(ALIAS_PREFIX) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const ownerId = (value as Record<string, unknown>).ownerId;
    if (isValidAccountOwnerId(ownerId)) owners.add(ownerId);
  }
  return owners;
}

export function createSettingsWriteCoordinator(
  storage: Storage = chrome.storage.local,
  queue: SerialWriteQueue = createSerialWriteQueue()
): { commit(request: unknown): Promise<SettingsCommitResponse> } {
  return {
    commit(request: unknown): Promise<SettingsCommitResponse> {
      return queue.run(async (): Promise<SettingsCommitResponse> => {
        if (!isRequest(request)) return { ok: false, error: 'Invalid settings update request' };
        try {
          if (request.action === 'register-account') {
            const all = await storage.get(null) as Record<string, unknown>;
            const settings = readSettingsMap(all[ACCOUNT_SETTINGS_KEY]);
            const emails = readAccountEmails(all[ACCOUNT_EMAILS_KEY]);
            const emailChanged = !!request.email && emails[request.ownerId] !== request.email;
            if (request.email) emails[request.ownerId] = request.email;
            const emailValues = emailChanged ? { [ACCOUNT_EMAILS_KEY]: emails } : {};

            if (all[MIGRATION_KEY] === true && Object.hasOwn(settings, request.ownerId)) {
              if (!emailChanged) return { ok: true };
              return persistVerified(storage, all, emailValues, '保存账号邮箱');
            }
            if (all[MIGRATION_KEY] === true) {
              settings[request.ownerId] = { theme: { ...DEFAULT_THEME }, sidebar: { ...DEFAULT_SIDEBAR } };
              return persistVerified(storage, all, {
                [ACCOUNT_SETTINGS_KEY]: settings, ...emailValues,
              }, '初始化账号设置');
            }
            const theme = legacyTheme(all);
            const sidebar = legacySidebar(all);
            for (const ownerId of collectKnownOwners(all, request.ownerId)) {
              if (!Object.hasOwn(settings, ownerId)) settings[ownerId] = { theme: { ...theme }, sidebar: { ...sidebar } };
            }
            const result = await persistVerified(storage, all, {
              [ACCOUNT_SETTINGS_KEY]: settings, [MIGRATION_KEY]: true, ...emailValues,
            }, '迁移账号设置');
            if (result.ok) {
              await storage.remove([
                LEGACY_THEME_SETTINGS_KEY, LEGACY_THEME_KEY, LEGACY_SIDEBAR_KEY,
              ]).catch(() => undefined);
            }
            return result;
          }

          const stored = await storage.get(ACCOUNT_SETTINGS_KEY) as Record<string, unknown>;
          const settings = readSettingsMap(stored[ACCOUNT_SETTINGS_KEY]);
          const current = settings[request.ownerId];
          if (!current) return { ok: false, error: '目标账号尚未初始化设置；请刷新已登录的 ChatGPT 页面后重试。' };
          const next = Object.assign(Object.create(null) as AccountSettingsMap, settings);
          if (request.action === 'theme') {
            next[request.ownerId] = { ...current, theme: { ...request.settings } };
          } else {
            next[request.ownerId] = { ...current, sidebar: { ...current.sidebar, ...request.patch } };
            if (!isSidebar(next[request.ownerId].sidebar)) {
              return { ok: false, error: '侧边栏设置无效，未保存。' };
            }
          }
          return persistVerified(storage, stored, { [ACCOUNT_SETTINGS_KEY]: next },
            request.action === 'theme' ? '保存主题设置' : '保存侧边栏设置');
        } catch (error) {
          return { ok: false, error: errorText(error) };
        }
      });
    },
  };
}
