/**
 * @vitest-environment jsdom
 * Verifies ChatGPT routing for standalone and project conversations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { getCurrentRouteKey } from '@/platforms/chatgpt/routing';

describe('ChatGPT conversation routing', () => {
  const initialPath = location.pathname;

  afterEach(() => {
    history.replaceState(null, '', initialPath);
  });

  it.each([
    ['/c/standalone-123', 'standalone-123'],
    ['/c/standalone-123/', 'standalone-123'],
    ['/g/g-p-workspace/c/project-456', 'project-456'],
    ['/g/g-p-workspace/c/project-456/', 'project-456'],
    ['/g/g-p-workspace', 'new-chat:/g/g-p-workspace'],
    ['/c/', 'new-chat:/c/'],
  ])('resolves %s to %s', (path, expected) => {
    history.replaceState(null, '', path);
    expect(getCurrentRouteKey()).toBe(expected);
  });
});
