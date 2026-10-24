/** Defines and persists LunaTOC's account-scoped theme preference. */
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeSettings {
  followChatGPT: boolean;
  manualTheme: ResolvedTheme;
}

import { SETTINGS_COMMIT_TYPE, type SettingsCommitResponse } from '@/features/storage/settingsWriteCoordinator';
import {
  ACCOUNT_SETTINGS_KEY, isValidAccountOwnerId, readStoredAccountSettings,
  resolveAccountSettingsOwner,
} from '@/features/storage/accountSettings';
import { getActiveConversationOwner, subscribeActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';

const DEFAULT_SETTINGS: ThemeSettings = { followChatGPT: true, manualTheme: 'dark' };

function normalizeThemeSettings(value: unknown): ThemeSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<ThemeSettings>;
  if (typeof candidate.followChatGPT !== 'boolean' ||
      (candidate.manualTheme !== 'dark' && candidate.manualTheme !== 'light')) return null;
  return { followChatGPT: candidate.followChatGPT, manualTheme: candidate.manualTheme };
}

/** Reads only the selected account's theme; an unverified context gets safe defaults. */
export async function readThemeSettings(ownerId?: string): Promise<ThemeSettings> {
  const owner = ownerId ?? await resolveAccountSettingsOwner();
  if (!owner || !isValidAccountOwnerId(owner)) return { ...DEFAULT_SETTINGS };
  const record = await readStoredAccountSettings(owner);
  const raw = record && typeof record === 'object' && !Array.isArray(record)
    ? (record as Record<string, unknown>).theme : undefined;
  return normalizeThemeSettings(raw) ?? { ...DEFAULT_SETTINGS };
}

/** Saves a complete theme preference only for a known, verified account. */
export async function writeThemeSettings(settings: ThemeSettings, ownerId?: string): Promise<void> {
  if (!chrome.runtime?.id) throw new Error('Invalid extension context: theme setting not saved');
  const owner = ownerId ?? await resolveAccountSettingsOwner();
  if (!owner || !isValidAccountOwnerId(owner)) {
    throw new Error('无法确认当前 ChatGPT 账号，主题设置未保存。');
  }
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: SETTINGS_COMMIT_TYPE, action: 'theme', ownerId: owner, settings,
    }, (response: SettingsCommitResponse | undefined) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message ?? 'Settings writer unavailable'));
      else if (response?.ok) resolve();
      else reject(new Error(response && 'error' in response ? response.error : 'Settings writer did not confirm the save'));
    });
  });
}

/** Subscribes to one account's preference and follows verified account switches in page contexts. */
export function subscribeThemeSettings(
  listener: (settings: ThemeSettings) => void,
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
      ? (record as Record<string, unknown>).theme : undefined;
    listener(normalizeThemeSettings(raw) ?? { ...DEFAULT_SETTINGS });
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
    if (nextOwner) void readThemeSettings(nextOwner).then((settings) => {
      if (active) listener(settings);
    }).catch(() => undefined);
    else if (active) listener({ ...DEFAULT_SETTINGS });
  });
  if (!resolvedOwner && !ownerId) {
    void resolveAccountSettingsOwner().then((owner) => {
      resolvedOwner = owner;
      if (owner) void readThemeSettings(owner).then((settings) => {
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
