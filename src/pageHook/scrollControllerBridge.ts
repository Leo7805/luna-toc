/**
 * MAIN-world React Fiber scroll-controller discovery and request handlers
 * (`holdViewport` and `scrollToBottom`) for ChatGPT.
 */
import {
  CHATGPT_BRIDGE_PROTOCOL,
  type HoldViewportBridgeRequest,
  type HoldViewportBridgeResponse,
  type ScrollToBottomBridgeRequest,
  type ScrollToBottomBridgeResponse,
} from '@/platforms/chatgpt/virtualLayoutBridgeProtocol';

/**
 * Minimal structural contract for ChatGPT's native scroll controller in MAIN world.
 */
export interface ChatGptScrollController {
  getScrollElement: () => unknown;
  holdViewport: () => void;
  scrollToBottom?: () => void;
}

const MAX_ANCESTOR_HOPS = 40;
const MAX_HOOKS_PER_FIBER = 100;

function isMatchingScrollController(
  candidate: unknown,
  container: HTMLElement
): candidate is ChatGptScrollController {
  if (!candidate || typeof candidate !== 'object') return false;
  const ctrl = candidate as Partial<ChatGptScrollController>;
  if (
    typeof ctrl.getScrollElement !== 'function' ||
    typeof ctrl.holdViewport !== 'function'
  ) {
    return false;
  }
  try {
    return ctrl.getScrollElement() === container;
  } catch {
    return false;
  }
}

function extractMatchingScrollController(
  candidate: unknown,
  container: HTMLElement
): ChatGptScrollController | null {
  if (!candidate || typeof candidate !== 'object') return null;
  if (isMatchingScrollController(candidate, container)) {
    return candidate;
  }
  const record = candidate as Record<string, unknown>;
  if (isMatchingScrollController(record.current, container)) {
    return record.current;
  }
  if (isMatchingScrollController(record.value, container)) {
    return record.value;
  }
  for (const key of Object.keys(record)) {
    let val: unknown;
    try {
      val = record[key];
    } catch {
      continue;
    }
    if (isMatchingScrollController(val, container)) {
      return val;
    }
    if (
      val &&
      typeof val === 'object' &&
      isMatchingScrollController((val as Record<string, unknown>).current, container)
    ) {
      return (val as Record<string, unknown>).current as ChatGptScrollController;
    }
  }
  return null;
}

/**
 * Traverses React Fiber ancestors from `container` to locate ChatGPT's native
 * scroll controller using structural method validation (`getScrollElement() === container`
 * and `typeof holdViewport === 'function'`).
 *
 * @param container Active `.thread-scroll-container` element.
 * @returns Validated scroll controller, or null if unavailable.
 *
 * @example
 * const controller = findMainWorldScrollController(scrollContainer);
 * controller?.holdViewport();
 */
export function findMainWorldScrollController(
  container: HTMLElement
): ChatGptScrollController | null {
  try {
    const allKeys = Object.keys(container);
    const fiberKey =
      allKeys.find((key) => key.startsWith('__reactFiber$')) ||
      allKeys.find((key) => key.startsWith('__reactInternalInstance$'));
    if (!fiberKey) return null;

    let fiber: any = (container as any)[fiberKey];
    const visitedFibers = new Set<any>();
    let ancestorHops = 0;

    while (fiber && ancestorHops < MAX_ANCESTOR_HOPS) {
      if (visitedFibers.has(fiber)) break;
      visitedFibers.add(fiber);
      ancestorHops++;

      const fibersToCheck = fiber.alternate
        ? [fiber, fiber.alternate]
        : [fiber];

      for (const f of fibersToCheck) {
        const fromProps = extractMatchingScrollController(
          f.memoizedProps,
          container
        );
        if (fromProps) return fromProps;

        let hook = f.memoizedState;
        const visitedHooks = new Set<any>();
        let hookHops = 0;

        while (hook && hookHops < MAX_HOOKS_PER_FIBER) {
          if (visitedHooks.has(hook)) break;
          visitedHooks.add(hook);
          hookHops++;

          const fromHook = extractMatchingScrollController(
            hook.memoizedState,
            container
          );
          if (fromHook) return fromHook;

          hook = hook.next;
        }
      }

      fiber = fiber.return;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Handles incoming hold-viewport requests in the page MAIN world.
 * Disarms ChatGPT's bottom-follow controller once before intentional navigation.
 *
 * @param event The dispatched CustomEvent from ISOLATED world.
 */
export function handleHoldViewportRequest(event: Event): void {
  try {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.isConnected ||
      !target.classList.contains('thread-scroll-container')
    ) {
      return;
    }

    const customEvent = event as CustomEvent;
    if (typeof customEvent.detail !== 'string') {
      return;
    }

    let request: HoldViewportBridgeRequest;
    try {
      request = JSON.parse(customEvent.detail) as HoldViewportBridgeRequest;
    } catch {
      return;
    }

    if (!request || typeof request.requestId !== 'string' || !request.requestId) {
      return;
    }

    let response: HoldViewportBridgeResponse;
    const controller = findMainWorldScrollController(target);
    if (!controller) {
      response = {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'controller-unavailable',
      };
    } else {
      try {
        controller.holdViewport();
        response = {
          requestId: request.requestId,
          status: 'ok',
        };
      } catch {
        response = {
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'hold-viewport-failed',
        };
      }
    }

    target.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.HOLD_VIEWPORT_RESPONSE, {
        bubbles: false,
        detail: JSON.stringify(response),
      })
    );
  } catch {
    // Fail closed: never leak exceptions outward into host page
  }
}

/**
 * Handles incoming scroll-to-bottom requests in the page MAIN world.
 * Invokes ChatGPT's validated native `controller.scrollToBottom()` when available.
 *
 * @param event The dispatched CustomEvent from ISOLATED world.
 */
export function handleScrollToBottomRequest(event: Event): void {
  try {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.isConnected ||
      !target.classList.contains('thread-scroll-container')
    ) {
      return;
    }

    const customEvent = event as CustomEvent;
    if (typeof customEvent.detail !== 'string') {
      return;
    }

    let request: ScrollToBottomBridgeRequest;
    try {
      request = JSON.parse(customEvent.detail) as ScrollToBottomBridgeRequest;
    } catch {
      return;
    }

    if (!request || typeof request.requestId !== 'string' || !request.requestId) {
      return;
    }

    let response: ScrollToBottomBridgeResponse;
    const controller = findMainWorldScrollController(target);
    if (!controller) {
      response = {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'controller-unavailable',
      };
    } else if (typeof controller.scrollToBottom !== 'function') {
      response = {
        requestId: request.requestId,
        status: 'unavailable',
        reason: 'scroll-to-bottom-missing',
      };
    } else {
      try {
        controller.scrollToBottom();
        response = {
          requestId: request.requestId,
          status: 'ok',
        };
      } catch {
        response = {
          requestId: request.requestId,
          status: 'unavailable',
          reason: 'scroll-to-bottom-failed',
        };
      }
    }

    target.dispatchEvent(
      new CustomEvent(CHATGPT_BRIDGE_PROTOCOL.EVENTS.SCROLL_TO_BOTTOM_RESPONSE, {
        bubbles: false,
        detail: JSON.stringify(response),
      })
    );
  } catch {
    // Fail closed: never leak exceptions outward into host page
  }
}
