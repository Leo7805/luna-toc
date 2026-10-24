/** Persists LunaTOC's independent layout and appearance preferences. */
export type SidebarLayoutMode = 'side-by-side' | 'overlay';
export type SidebarColor = 'default' | 'blue' | 'green' | 'yellow' | 'pink' |
  'orange' | 'purple' | 'red' | 'cyan' | 'lime' | 'magenta';

export interface SidebarPreferences {
  layoutMode: SidebarLayoutMode;
  backgroundColor: SidebarColor;
  revealTint: boolean;
}

import { SETTINGS_COMMIT_TYPE, type SettingsCommitResponse } from '@/features/storage/settingsWriteCoordinator';
import {
  ACCOUNT_SETTINGS_KEY, readStoredAccountSettings, resolveAccountSettingsOwner,
  isValidAccountOwnerId,
} from '@/features/storage/accountSettings';
import { getActiveConversationOwner, subscribeActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';

/** Compatibility export: account preferences are stored together under one key. */
export const SIDEBAR_SETTINGS_KEY = ACCOUNT_SETTINGS_KEY;
export const SIDEBAR_COLORS: ReadonlyArray<{
  id: SidebarColor;
  label: string;
  hex: string;
}> = [
  { id: 'default', label: '默认', hex: '#8b93a7' },
  { id: 'blue', label: '蓝色', hex: '#4799eb' },
  { id: 'green', label: '绿色', hex: '#36b58b' },
  { id: 'yellow', label: '黄色', hex: '#e8be45' },
  { id: 'pink', label: '粉色', hex: '#eb83b4' },
  { id: 'orange', label: '橙色', hex: '#e99656' },
  { id: 'purple', label: '紫色', hex: '#9c88e9' },
  { id: 'red', label: '红色', hex: '#e36c70' },
  { id: 'cyan', label: '青色', hex: '#4ac3cb' },
  { id: 'lime', label: '青柠', hex: '#a5cc54' },
  { id: 'magenta', label: '洋红', hex: '#d76bd5' },
];

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
  layoutMode: 'overlay',
  backgroundColor: 'default',
  revealTint: false,
};

/** Validates each persisted setting without discarding other good fields. */
export function normalizeSidebarPreferences(value: unknown): SidebarPreferences {
  const raw = value && typeof value === 'object'
    ? value as Partial<SidebarPreferences> : {};
  return {
    layoutMode: raw.layoutMode === 'side-by-side' ? 'side-by-side' : 'overlay',
    backgroundColor: SIDEBAR_COLORS.some((color) => color.id === raw.backgroundColor)
      ? raw.backgroundColor as SidebarColor : 'default',
    revealTint: raw.revealTint === true,
  };
}

/** Reads only the requested or independently verified active account's preferences. */
export async function readSidebarPreferences(ownerId?: string): Promise<SidebarPreferences> {
  const owner = ownerId ?? await resolveAccountSettingsOwner();
  if (!owner || !isValidAccountOwnerId(owner)) return { ...DEFAULT_SIDEBAR_PREFERENCES };
  const record = await readStoredAccountSettings(owner);
  const raw = record && typeof record === 'object' && !Array.isArray(record)
    ? (record as Record<string, unknown>).sidebar : undefined;
  return normalizeSidebarPreferences(raw);
}

/** Persists a patch only to its account; the background writer validates ownership and values. */
export async function writeSidebarPreferences(
  patch: Partial<SidebarPreferences>,
  ownerId?: string
): Promise<void> {
  if (!chrome.runtime?.id) throw new Error('Invalid extension context: sidebar setting not saved');
  const owner = ownerId ?? await resolveAccountSettingsOwner();
  if (!owner || !isValidAccountOwnerId(owner)) {
    throw new Error('无法确认当前 ChatGPT 账号，侧边栏设置未保存。');
  }
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: SETTINGS_COMMIT_TYPE, action: 'sidebar-patch', ownerId: owner, patch,
    }, (response: SettingsCommitResponse | undefined) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message ?? 'Settings writer unavailable'));
      else if (response?.ok) resolve();
      else reject(new Error(response && 'error' in response
        ? response.error : 'Settings writer did not confirm the save'));
    });
  });
}

/** Reacts to one account's changes and follows verified account switches in page contexts. */
export function subscribeSidebarPreferences(
  listener: (settings: SidebarPreferences) => void,
  ownerId?: string
): () => void {
  let resolvedOwner = ownerId ?? getActiveConversationOwner();
  let active = true;
  const publish = (mapValue: unknown, requestedOwner: string | null | undefined): void => {
    if (!active) return;
    const owner = ownerId ?? requestedOwner ?? resolvedOwner;
    if (!owner || !mapValue || typeof mapValue !== 'object' || Array.isArray(mapValue)) return;
    const map = mapValue as Record<string, unknown>;
    const record = Object.hasOwn(map, owner) ? map[owner] : null;
    const raw = record && typeof record === 'object' && !Array.isArray(record)
      ? (record as Record<string, unknown>).sidebar : undefined;
    listener(normalizeSidebarPreferences(raw));
  };
  const onChange = (
    changes: Record<string, chrome.storage.StorageChange>,
    areaName: string
  ): void => {
    if (areaName === 'local' && changes[ACCOUNT_SETTINGS_KEY]) {
      publish(changes[ACCOUNT_SETTINGS_KEY].newValue, getActiveConversationOwner());
    }
  };
  chrome.storage.onChanged.addListener(onChange);
  const unsubscribeOwner = ownerId ? () => {} : subscribeActiveConversationOwner(() => {
    const nextOwner = getActiveConversationOwner();
    resolvedOwner = nextOwner;
    if (nextOwner) void readSidebarPreferences(nextOwner).then((settings) => {
      if (active) listener(settings);
    }).catch(() => undefined);
    else if (active) listener({ ...DEFAULT_SIDEBAR_PREFERENCES });
  });
  if (!resolvedOwner && !ownerId) {
    void resolveAccountSettingsOwner().then((owner) => {
      resolvedOwner = owner;
      if (owner) void readSidebarPreferences(owner).then((settings) => {
        if (active) listener(settings);
      }).catch(() => undefined);
    });
  }
  return () => {
    active = false;
    chrome.storage.onChanged.removeListener(onChange);
    unsubscribeOwner();
  };
}

function hexRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((n) => Number.parseInt(hex.slice(n, n + 2), 16)) as
    [number, number, number];
}

function mix(base: readonly number[], tint: readonly number[], weight: number): string {
  return base.map((channel, index) =>
    Math.round(channel * (1 - weight) + tint[index] * weight)
  ).join(', ');
}

/**
 * Computes contrast-safe tinted sidebar surfaces and the same colored
 * semi-transparent reveal edge. The default keeps legacy surface colors.
 */
export function sidebarAppearance(
  settings: SidebarPreferences,
  theme: 'dark' | 'light'
): { background: string | null; header: string | null; reveal: string } {
  const color = SIDEBAR_COLORS.find((entry) => entry.id === settings.backgroundColor)!;
  const base = theme === 'dark' ? [16, 24, 39] : [238, 245, 255];
  const tint = hexRgb(color.hex);
  const surface = settings.backgroundColor === 'default'
    ? null : mix(base, tint, theme === 'dark' ? 0.27 : 0.20);
  const header = settings.backgroundColor === 'default'
    ? null : mix(base, tint, theme === 'dark' ? 0.33 : 0.24);
  const revealColor = settings.backgroundColor === 'default' ? base : tint;
  return {
    background: surface ? `rgba(${surface}, 0.94)` : null,
    header: header ? `rgba(${header}, 0.95)` : null,
    reveal: settings.revealTint
      ? `rgba(${revealColor.join(', ')}, 0.42)`
      : 'transparent',
  };
}
