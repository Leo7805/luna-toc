/** Shared account-scoped preference storage and verified active-tab resolution. */
import type { ThemeSettings } from '@/features/theme/themeSettings';
import type { SidebarPreferences } from '@/features/sidebar/sidebarPreferences';
import { getActiveConversationOwner } from '@/navigation/lifecycle/conversationOwner';

export const ACCOUNT_SETTINGS_KEY = 'chatToc:accountSettings:v1';
export const ACCOUNT_EMAILS_KEY = 'chatToc:accountEmails:v1';
export const GET_ACTIVE_ACCOUNT_OWNER_MESSAGE = 'LUNA_TOC_GET_ACTIVE_ACCOUNT_OWNER_V1';

export interface AccountSettingsRecord {
  theme: ThemeSettings;
  sidebar: SidebarPreferences;
}
export type AccountSettingsMap = Record<string, AccountSettingsRecord>;

export function isValidAccountOwnerId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && value.length <= 256 &&
    value !== '__proto__' && value !== 'constructor' && value !== 'prototype';
}

export function isValidAccountEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 &&
    value.trim() === value && /^[^\s@]+@[^\s@]+$/.test(value);
}

/** Returns only validated local email labels keyed by verified account ID. */
export function accountSettingsEmails(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const emails: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [ownerId, email] of Object.entries(value as Record<string, unknown>)) {
    if (isValidAccountOwnerId(ownerId) && isValidAccountEmail(email)) emails[ownerId] = email;
  }
  return emails;
}

/** Lists only structurally usable account entries; detailed values are normalized by their readers. */
export function accountSettingsOwners(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([ownerId, record]) => isValidAccountOwnerId(ownerId) &&
      !!record && typeof record === 'object' && !Array.isArray(record) &&
      Object.hasOwn(record, 'theme') && Object.hasOwn(record, 'sidebar'))
    .map(([ownerId]) => ownerId)
    .sort((left, right) => left.localeCompare(right));
}

/** Resolves the current ChatGPT tab's identity for extension pages such as the popup. */
export async function resolveAccountSettingsOwner(): Promise<string | null> {
  const isolatedOwner = getActiveConversationOwner();
  if (isValidAccountOwnerId(isolatedOwner)) return isolatedOwner;
  if (typeof chrome === 'undefined' || !chrome.tabs?.query || !chrome.tabs?.sendMessage) return null;

  let tab: chrome.tabs.Tab | undefined;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = tabs[0];
  } catch {
    return null;
  }
  if (tab?.id === undefined || !/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)(?:\/|$)/.test(tab.url ?? '')) {
    return null;
  }

  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tab!.id!, { type: GET_ACTIVE_ACCOUNT_OWNER_MESSAGE }, (response: unknown) => {
        if (chrome.runtime.lastError || !response || typeof response !== 'object') {
          resolve(null);
          return;
        }
        const ownerId = (response as { ownerId?: unknown }).ownerId;
        resolve(isValidAccountOwnerId(ownerId) ? ownerId : null);
      });
    } catch {
      resolve(null);
    }
  });
}

/** Returns an account record without trusting its field values; callers normalize them. */
export async function readStoredAccountSettings(ownerId: string): Promise<unknown> {
  if (!isValidAccountOwnerId(ownerId)) return null;
  const values = await chrome.storage.local.get(ACCOUNT_SETTINGS_KEY);
  const map = values[ACCOUNT_SETTINGS_KEY];
  if (!map || typeof map !== 'object' || Array.isArray(map) ||
      !Object.hasOwn(map, ownerId)) return null;
  return (map as Record<string, unknown>)[ownerId];
}
