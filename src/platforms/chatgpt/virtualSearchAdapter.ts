/**
 * Adapts ChatGPT DOM and scrolling state to generic virtual-search inputs.
 */
import {
  createNavigationAnchor,
  type NavigationAnchor,
} from '@/features/navigation/navigationAnchorStore';
import type { NavigationFingerprintIndex } from '@/features/navigation/fingerprint/index';
import type { NavigationSegmentIndex } from '@/features/navigation/fingerprint/segments';
import {
  resolvePromptIndexesFromIds,
  resolveVisiblePromptPosition,
  type LocatedVisiblePromptPosition,
  type VisiblePromptPosition,
} from '@/features/navigation/visiblePositionResolver';
import type {
  VirtualScrollMetrics,
  VirtualSearchObservation,
} from '@/features/navigation/virtualSearchController';
import {
  getRenderedAssistantEntries,
  getVisibleAssistantViewportSamples,
} from './renderedTextAdapter';

const USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';
const ASSISTANT_MESSAGE_SELECTOR = '[data-message-author-role="assistant"]';

export interface ChatGptVirtualPositionOptions {
  conversationKey: string;
  prompts: ReadonlyArray<{ id: string }>;
  fingerprintIndex: NavigationFingerprintIndex;
  segmentIndex: NavigationSegmentIndex;
  root?: ParentNode;
  scrollContainer?: HTMLElement | null;
}

interface ChatGptMountNodeDiagnostic {
  tagName: string;
  role: string | null;
  messageId: string | null;
  navigatorIndex: number;
  matchesTargetPromptText: boolean;
  turn: string | null;
  connected: boolean;
  visible: boolean;
  top: number;
  bottom: number;
  height: number;
}

export interface ChatGptPromptMountDiagnostic {
  mountedUserMessageCount: number;
  visibleUserMessages: ChatGptMountNodeDiagnostic[];
  targetPromptCandidates: ChatGptMountNodeDiagnostic[];
  targetIdNodes: ChatGptMountNodeDiagnostic[];
  matchedAssistantNodes: ChatGptMountNodeDiagnostic[];
}

/**
 * Finds the scrollable container that owns ChatGPT's mounted messages.
 *
 * @example
 * const container = getChatGptScrollContainer(document);
 */
export function getChatGptScrollContainer(
  root: ParentNode = document
): HTMLElement | null {
  const sampleMessage =
    root.querySelector<HTMLElement>(USER_MESSAGE_SELECTOR) ||
    root.querySelector<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR);
  let parent = sampleMessage?.parentElement || null;

  while (parent && parent !== document.body) {
    if (isVerticallyScrollable(parent)) return parent;
    parent = parent.parentElement;
  }

  const selectorFallback =
    root.querySelector<HTMLElement>('main div.overflow-y-auto') ||
    root.querySelector<HTMLElement>('[class*="react-scroll-to-bottom"]') ||
    root.querySelector<HTMLElement>('main [class*="react-scroll-to-bottom"]');

  if (selectorFallback) return selectorFallback;

  const main = root.querySelector<HTMLElement>('main');
  if (!main) return null;

  return (
    Array.from(main.querySelectorAll<HTMLElement>('div')).find(
      isVerticallyScrollable
    ) || null
  );
}

/**
 * Finds a currently mounted ChatGPT user message by its stable message ID.
 *
 * @example
 * const prompt = findRenderedChatGptPrompt('prompt-message-id');
 */
export function findRenderedChatGptPrompt(
  promptId: string,
  root: ParentNode = document
): HTMLElement | null {
  return (
    Array.from(root.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR)).find(
      (element) => getChatGptMessageId(element) === promptId
    ) || null
  );
}

/**
 * Returns whether a mounted element intersects the active chat viewport.
 *
 * @example
 * const visible = isChatGptElementVisible(prompt, scrollContainer);
 */
export function isChatGptElementVisible(
  element: HTMLElement,
  scrollContainer: HTMLElement
): boolean {
  return isElementWithinScrollViewport(
    element,
    scrollContainer.getBoundingClientRect()
  );
}

/**
 * Returns current scroll measurements for the generic search controller.
 */
export function getChatGptScrollMetrics(
  container: HTMLElement
): VirtualScrollMetrics {
  return {
    scrollTop: container.scrollTop,
    maximumScrollTop: Math.max(
      0,
      container.scrollHeight - container.clientHeight
    ),
    viewportWidth: container.clientWidth || window.innerWidth,
    viewportHeight: container.clientHeight || window.innerHeight,
  };
}

/**
 * Collects text-free DOM evidence when a target Prompt cannot be mounted.
 */
export function getChatGptPromptMountDiagnostic({
  promptId,
  matchedBlockIds,
  scrollContainer,
  getNavigatorIndex,
  matchesTargetPromptText,
  root = document,
}: {
  promptId: string;
  matchedBlockIds: string[];
  scrollContainer: HTMLElement;
  getNavigatorIndex: (element: HTMLElement) => number;
  matchesTargetPromptText: (element: HTMLElement) => boolean;
  root?: ParentNode;
}): ChatGptPromptMountDiagnostic {
  const userMessages = Array.from(
    root.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR)
  );
  const idNodes = Array.from(
    root.querySelectorAll<HTMLElement>('[data-message-id]')
  );
  const matchedBlockIdSet = new Set(matchedBlockIds);
  const assistantMessages = Array.from(
    root.querySelectorAll<HTMLElement>(ASSISTANT_MESSAGE_SELECTOR)
  );

  return {
    mountedUserMessageCount: userMessages.length,
    visibleUserMessages: userMessages
      .filter((element) =>
        isChatGptElementVisible(element, scrollContainer)
      )
      .map((element) =>
        createMountNodeDiagnostic(
          element,
          scrollContainer,
          getNavigatorIndex,
          matchesTargetPromptText
        )
      ),
    targetPromptCandidates: userMessages
      .filter((element) => getChatGptMessageId(element) === promptId)
      .map((element) =>
        createMountNodeDiagnostic(
          element,
          scrollContainer,
          getNavigatorIndex,
          matchesTargetPromptText
        )
      ),
    targetIdNodes: idNodes
      .filter((element) => element.dataset.messageId === promptId)
      .map((element) =>
        createMountNodeDiagnostic(
          element,
          scrollContainer,
          getNavigatorIndex,
          matchesTargetPromptText
        )
      ),
    matchedAssistantNodes: assistantMessages
      .filter((element, index) =>
        matchedBlockIdSet.has(getAssistantMessageId(element, index))
      )
      .map((element) =>
        createMountNodeDiagnostic(
          element,
          scrollContainer,
          getNavigatorIndex,
          matchesTargetPromptText
        )
      ),
  };
}

/**
 * Returns mounted user messages that intersect the chat viewport.
 */
function getVisibleUserMessages(
  root: ParentNode,
  scrollContainer: HTMLElement
): HTMLElement[] {
  const containerRect = scrollContainer.getBoundingClientRect();

  return Array.from(root.querySelectorAll<HTMLElement>(USER_MESSAGE_SELECTOR))
    .filter((element) => isElementWithinScrollViewport(element, containerRect));
}

/**
 * Resolves the visible prompt-index range from exact user-message IDs.
 *
 * Returns null when no visible user message maps to a known prompt, so the
 * caller can fall back to text-fingerprint resolution.
 */
function resolveVisiblePromptPositionByUserMessageId(
  prompts: ReadonlyArray<{ id: string }>,
  scrollContainer: HTMLElement,
  root: ParentNode
): LocatedVisiblePromptPosition | null {
  const visibleUserMessages = getVisibleUserMessages(root, scrollContainer);

  return resolvePromptIndexesFromIds(
    visibleUserMessages.map((element) => getChatGptMessageId(element)),
    prompts
  );
}

/**
 * Resolves mounted Assistant responses and converts their element positions
 * into prompt-specific in-memory navigation anchors.
 *
 * @example
 * const observation = await observeChatGptVirtualPosition({
 *   conversationKey,
 *   prompts,
 *   fingerprintIndex,
 * });
 */
export async function observeChatGptVirtualPosition({
  conversationKey,
  prompts,
  fingerprintIndex,
  segmentIndex,
  root = document,
  scrollContainer = getChatGptScrollContainer(root),
}: ChatGptVirtualPositionOptions): Promise<VirtualSearchObservation> {
  if (!scrollContainer) {
    return {
      position: { status: 'none' },
      anchors: [],
    };
  }

  const directPosition = resolveVisiblePromptPositionByUserMessageId(
    prompts,
    scrollContainer,
    root
  );

  if (directPosition) {
    const visibleUserMessages = getVisibleUserMessages(root, scrollContainer);
    const elementsByBlockId = new Map<string, HTMLElement>();

    for (const element of visibleUserMessages) {
      const id = getChatGptMessageId(element);
      if (id) elementsByBlockId.set(id, element);
    }

    const anchors = directPosition.matchedBlocks.flatMap(
      ({ blockId, promptIndex }): NavigationAnchor[] => {
        const element = elementsByBlockId.get(blockId);
        const prompt = prompts[promptIndex];

        if (!element || !prompt) return [];

        return [
          createChatGptElementNavigationAnchor({
            conversationKey,
            promptId: prompt.id,
            promptIndex,
            element,
            scrollContainer,
          }),
        ];
      }
    );

    return { position: directPosition, anchors };
  }

  const entries = getRenderedAssistantEntries(root);
  const containerRect = scrollContainer.getBoundingClientRect();
  const visibleEntries = entries.filter(({ element }) =>
    isElementWithinScrollViewport(element, containerRect)
  );
  const validFingerprintIndex = fingerprintIndex.filter(
    ({ promptIndex }) => promptIndex >= 0 && promptIndex < prompts.length
  );
  const validDerivedSegmentIndex = segmentIndex.filter(
    ({ promptIndex, quality }) =>
      quality === 'derived' &&
      promptIndex >= 0 &&
      promptIndex < prompts.length
  );
  const viewportSamples = getVisibleAssistantViewportSamples(
    scrollContainer,
    root
  );
  const position = await resolveVisiblePromptPosition(
    visibleEntries.map(({ block }) => block),
    validFingerprintIndex,
    validDerivedSegmentIndex,
    viewportSamples
  );

  if (position.status !== 'located') {
    return {
      position,
      anchors: [],
    };
  }

  const elementsByBlockId = new Map(
    visibleEntries.map(({ block, element }) => [block.id, element])
  );
  const anchors = position.matchedBlocks.flatMap(
    ({ blockId, promptIndex }): NavigationAnchor[] => {
      const element = elementsByBlockId.get(blockId);
      const prompt = prompts[promptIndex];

      if (!element || !prompt) return [];

      return [
        createChatGptElementNavigationAnchor({
          conversationKey,
          promptId: prompt.id,
          promptIndex,
          element,
          scrollContainer,
        }),
      ];
    }
  );

  return {
    position,
    anchors,
  };
}

/**
 * Converts one mounted Assistant element into a prompt scroll anchor.
 */
export function createChatGptElementNavigationAnchor({
  conversationKey,
  promptId,
  promptIndex,
  element,
  scrollContainer,
}: {
  conversationKey: string;
  promptId: string;
  promptIndex: number;
  element: HTMLElement;
  scrollContainer: HTMLElement;
}): NavigationAnchor {
  const containerRect = scrollContainer.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const anchorScrollTop =
    scrollContainer.scrollTop + elementRect.top - containerRect.top;

  return createNavigationAnchor({
    conversationKey,
    promptId,
    promptIndex,
    scrollTop: anchorScrollTop,
    scrollHeight: scrollContainer.scrollHeight,
    viewportWidth: scrollContainer.clientWidth || window.innerWidth,
    viewportHeight: scrollContainer.clientHeight || window.innerHeight,
  });
}

/**
 * Returns the closest message ID stored on an element or its turn wrapper.
 */
function getChatGptMessageId(element: HTMLElement): string | null {
  return (
    element.dataset.messageId ||
    element.closest<HTMLElement>('[data-message-id]')?.dataset.messageId ||
    null
  );
}

/**
 * Returns the rendered Assistant ID used by position diagnostics.
 */
function getAssistantMessageId(
  element: HTMLElement,
  index: number
): string {
  return (
    getChatGptMessageId(element) || `chatgpt-assistant-${index}`
  );
}

/**
 * Describes one mounted node without logging conversation text.
 */
function createMountNodeDiagnostic(
  element: HTMLElement,
  scrollContainer: HTMLElement,
  getNavigatorIndex: (element: HTMLElement) => number,
  matchesTargetPromptText: (element: HTMLElement) => boolean
): ChatGptMountNodeDiagnostic {
  const rect = element.getBoundingClientRect();

  return {
    tagName: element.tagName,
    role: element.dataset.messageAuthorRole || null,
    messageId: getChatGptMessageId(element),
    navigatorIndex: getNavigatorIndex(element),
    matchesTargetPromptText: matchesTargetPromptText(element),
    turn:
      element.closest<HTMLElement>('[data-turn]')?.dataset.turn ||
      null,
    connected: element.isConnected,
    visible: isChatGptElementVisible(element, scrollContainer),
    top: rect.top,
    bottom: rect.bottom,
    height: rect.height,
  };
}

/**
 * Checks whether an element declares vertical scrolling.
 */
function isVerticallyScrollable(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

/**
 * Returns whether an element intersects the chat container's visible viewport.
 */
function isElementWithinScrollViewport(
  element: HTMLElement,
  containerRect: DOMRect
): boolean {
  const elementRect = element.getBoundingClientRect();

  return (
    elementRect.bottom > containerRect.top &&
    elementRect.top < containerRect.bottom
  );
}
