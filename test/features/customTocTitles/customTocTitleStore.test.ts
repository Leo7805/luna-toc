/**
 * Tests persistence and caching of Custom TOC Titles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCustomTitle,
  initializeCustomTocTitles,
  removeCustomTitle,
  setCustomTitle,
} from '@/features/customTocTitles/customTocTitleStore';

const STORAGE_KEY = 'lunaToc:customTitlesV1';

let storedData: Record<string, unknown>;

beforeEach(() => {
  storedData = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storedData[key] })),
        set: vi.fn(async (data: Record<string, unknown>) => {
          Object.assign(storedData, data);
        }),
      },
    },
  });
});

describe('customTocTitleStore', () => {
  it('hydrates stored titles from chrome.storage.local', async () => {
    storedData[STORAGE_KEY] = {
      'msg-1': 'Architecture Overview',
      'msg-2': 'Bug Analysis',
    };

    await initializeCustomTocTitles();

    expect(getCustomTitle('msg-1')).toBe('Architecture Overview');
    expect(getCustomTitle('msg-2')).toBe('Bug Analysis');
    expect(getCustomTitle('msg-unknown')).toBeUndefined();
  });

  it('sets and persists a custom title', async () => {
    await initializeCustomTocTitles();

    await setCustomTitle('msg-3', '  New Feature Design  ');

    expect(getCustomTitle('msg-3')).toBe('New Feature Design');
    expect(storedData[STORAGE_KEY]).toEqual({
      'msg-3': 'New Feature Design',
    });
  });

  it('removes a custom title and updates storage', async () => {
    storedData[STORAGE_KEY] = { 'msg-1': 'Title One' };
    await initializeCustomTocTitles();

    await removeCustomTitle('msg-1');

    expect(getCustomTitle('msg-1')).toBeUndefined();
    expect(storedData[STORAGE_KEY]).toEqual({});
  });

  it('removes the title when setting an empty or whitespace-only title', async () => {
    storedData[STORAGE_KEY] = { 'msg-1': 'Existing Title' };
    await initializeCustomTocTitles();

    await setCustomTitle('msg-1', '   ');

    expect(getCustomTitle('msg-1')).toBeUndefined();
    expect(storedData[STORAGE_KEY]).toEqual({});
  });

  it('handles empty message IDs safely', async () => {
    await initializeCustomTocTitles();

    expect(getCustomTitle('')).toBeUndefined();
    await setCustomTitle('', 'Title');
    await removeCustomTitle('');

    expect(storedData[STORAGE_KEY]).toBeUndefined();
  });
});
