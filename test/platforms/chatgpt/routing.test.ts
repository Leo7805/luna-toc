/** Checks route entry points in the default Node environment without global leaks. */
import { afterEach, expect, it, vi } from 'vitest';
import { getCurrentRouteKey, newChatRouteKey } from '@/platforms/chatgpt/routing';
import { getCurrentConversationKey } from '@/pageHook/fetchHelpers';
import { inspectFetchRequest, isNewChatRouteKey } from '@/platforms/chatgpt/contentCapture';

afterEach(() => vi.unstubAllGlobals());

it.each([
  ['/c/A', 'A', false],
  ['/g/g-project/c/A', 'A', false],
  ['/c/local-temp', 'local-temp', true],
  ['/g/g-project/c/local-temp', 'local-temp', true],
  ['/', 'new-chat:/', true],
  ['/g/g-project', 'new-chat:/g/g-project', true],
  ['/c/', 'new-chat:/c/', true],
])('resolves %s consistently across request and route entry points', (pathname, expected, temporary) => {
  const testLocation = { pathname, origin: 'https://chatgpt.com', host: 'chatgpt.com' };
  vi.stubGlobal('location', testLocation);
  // Fetch URL resolution needs only an origin, not a DOM environment.
  vi.stubGlobal('window', { location: testLocation });
  expect(getCurrentRouteKey()).toBe(expected);
  expect(getCurrentConversationKey()).toBe(expected);
  expect(inspectFetchRequest(['/backend-api/f/conversation', { method: 'POST' }], '')?.routeKey)
    .toBe(expected);
  expect(isNewChatRouteKey(expected)).toBe(temporary);
  expect(newChatRouteKey(pathname)).toBe(`new-chat:${pathname}`);
});
