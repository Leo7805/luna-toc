/**
 * Pure data operations for the Step 2 mount queue.
 *
 * Step 2 walks the conversation toward a target prompt by stepping
 * `scrollTop` toward the target direction and re-reading the
 * ChatGPT-mounted DOM after each step. The window of prompts that
 * LunaTOC knows about at any moment is tracked here as a `MountQueue`
 * keyed by the ChatGPT unit key, so the main loop can ask three
 * questions cheaply:
 *
 *   - is the target already mounted?         (`findTargetInQueue`)
 *   - which prompts mounted since last step? (`detectNewMounts`)
 *   - what does the current queue look like? (`seedMountQueue`)
 *
 * None of these functions touch `container.scrollTop` — they only
 * read the DOM, which keeps them straightforward to unit-test without
 * a ChatGPT page.
 */
import {
  readMountedWithSidebarIdx,
  findRenderedChatGptPrompt,
} from '@/platforms/chatgpt/virtualSearchAdapter';

export interface MountQueueEntry {
  unitKey: string;
  sidebarIdx: number;
  element: HTMLElement;
}

/**
 * Stable lookup of every currently-known mounted prompt. Keyed by
 * `unitKey` (the ChatGPT `data-chatgpt-search-unit-key` attribute) so
 * that the same prompt mounted in two consecutive step iterations
 * counts once, while a freshly mounted prompt shows up as a new key.
 */
export type MountQueue = Map<string, MountQueueEntry>;

/**
 * Builds the initial queue from whatever ChatGPT already has mounted
 * in the DOM. Safe to call on every iteration — it never grows beyond
 * the current ChatGPT mount window (typically a few dozen entries).
 */
export function seedMountQueue(
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode = document
): MountQueue {
  const queue: MountQueue = new Map();
  const mounted = readMountedWithSidebarIdx(prompts, root);
  for (const entry of mounted) {
    queue.set(entry.unitKey, {
      unitKey: entry.unitKey,
      sidebarIdx: entry.sidebarIdx,
      element: entry.element,
    });
  }
  return queue;
}

/**
 * Returns every prompt that ChatGPT has newly mounted since `queue`
 * was last refreshed. A prompt that was unmounted and re-mounted
 * with the same `unitKey` is treated as "already known" (its entry
 * is overwritten so the element reference stays current).
 */
export function detectNewMounts(
  queue: MountQueue,
  prompts: ReadonlyArray<{ id: string }>,
  root: ParentNode = document
): MountQueueEntry[] {
  const mounted = readMountedWithSidebarIdx(prompts, root);
  const fresh: MountQueueEntry[] = [];
  for (const entry of mounted) {
    const existing = queue.get(entry.unitKey);
    if (!existing) {
      fresh.push({
        unitKey: entry.unitKey,
        sidebarIdx: entry.sidebarIdx,
        element: entry.element,
      });
    } else {
      // Refresh the element reference in case ChatGPT replaced the
      // underlying node during virtual render.
      existing.element = entry.element;
    }
  }
  return fresh;
}

/**
 * Returns the element for the target prompt if it is already known
 * to the queue, otherwise null. Tries the stable message id first
 * (covers the case where ChatGPT kept the same id across re-mounts),
 * then falls back to the sidebar index (covers the case where the id
 * string is a ChatGPT-generated placeholder for that index).
 */
export function findTargetInQueue(
  queue: MountQueue,
  targetId: string,
  targetIndex: number,
  root: ParentNode = document
): HTMLElement | null {
  // Fast path: the target's stable message id resolves to a current
  // mounted element. `findRenderedChatGptPrompt` already handles the
  // ancestor-attribute fallback for the new DOM.
  const byId = findRenderedChatGptPrompt(targetId, root);
  if (byId) return byId;

  // Fallback: match by sidebar index. Useful when the target's id
  // string doesn't line up (for example when ChatGPT has just
  // remounted the prompt under a placeholder id).
  for (const entry of queue.values()) {
    if (entry.sidebarIdx === targetIndex) return entry.element;
  }
  return null;
}

/**
 * Convenience helper: returns the sidebar indices of every entry in
 * the queue, suitable for direction calculations that only need the
 * index column.
 */
export function queueSidebarIndices(queue: MountQueue): number[] {
  const indices: number[] = [];
  for (const entry of queue.values()) indices.push(entry.sidebarIdx);
  return indices;
}