/**
 * Coordinates native same-tab SPA message navigation (`?message=<id>`) for
 * unmounted prompts without disarming the platform's scroll controller or
 * writing scroll positions while native routing settles.
 */
import type { NavigatorMessage } from '@/features/conversationPrompts/message';
import { keepFollowing } from '@/navigation/follow/follow';
import {
  logJumpFailedDiagnostic,
  logNavigationEvent,
} from '@/navigation/jump/jumpDiagnostics';
import { getActivePlatform } from '@/platforms';
import {
  findRenderedPrompt,
  getScrollContainer,
  highlightMatchedElement,
} from './promptLanding';
import { getMonotonicNowMs } from './promptStabilization';

const NATIVE_NAV_TIMEOUT_MS = 15_000;
const NATIVE_SETTLE_CHECK_MS = 50;
const NATIVE_STABLE_WINDOW_MS = 350;
const NATIVE_POSITION_TOLERANCE_PX = 4;
const NATIVE_TOP_OVERSCAN_PX = 20;

/**
 * Inputs for attempting native same-tab SPA message navigation.
 */
export interface NativeMessageJumpParams {
  conversationKey: string;
  message: NavigatorMessage;
  index: number;
  jumpId: string;
  mode: 'target-driven' | 'viewport-driven';
  container: HTMLElement;
  isCancelled: () => boolean;
  onJumpComplete?: (targetIndex: number) => void;
  clearJumpProgress: () => void;
  onMountFailure: (targetIndex: number) => void;
}

type NativeLandingOutcome =
  | { status: 'settled'; element: HTMLElement; relativeTopPx: number }
  | { status: 'cancelled' }
  | {
      status: 'failed';
      reason:
        | 'native-navigation-timeout'
        | 'native-target-disconnected'
        | 'native-target-unstable';
    };

function measureVisibleRelativeTop(
  element: HTMLElement,
  container: HTMLElement
): number | null {
  const containerRect = container.getBoundingClientRect();
  const targetRect = element.getBoundingClientRect();
  const viewportTop = containerRect.top;
  const viewportHeight =
    containerRect.height > 0
      ? containerRect.height
      : container.clientHeight || 900;
  const viewportBottom = viewportTop + viewportHeight;
  const relativeTop = targetRect.top - viewportTop;

  if (relativeTop < -NATIVE_TOP_OVERSCAN_PX || targetRect.top >= viewportBottom) {
    return null;
  }
  if (targetRect.height > 0 && targetRect.bottom <= viewportTop) {
    return null;
  }
  return relativeTop;
}

/**
 * Observes a natively routed target without touching `scrollTop` or calling
 * `holdViewport`, succeeding only once the target remains connected, visible
 * inside the scroll container, and positionally stable for a bounded window.
 */
async function waitForNativeLanding(
  messageId: string,
  initialContainer: HTMLElement,
  isCancelled: () => boolean
): Promise<NativeLandingOutcome> {
  const startedAt = getMonotonicNowMs();
  let sawMounted = false;
  let stableSince: number | null = null;
  let stableElement: HTMLElement | null = null;
  let lastRelativeTop: number | null = null;
  let lastScrollTop: number | null = null;

  while (getMonotonicNowMs() - startedAt < NATIVE_NAV_TIMEOUT_MS) {
    if (isCancelled()) {
      return { status: 'cancelled' };
    }

    const activeContainer = getScrollContainer() ?? initialContainer;
    const target = findRenderedPrompt(messageId);

    if (target && target.isConnected && activeContainer.isConnected) {
      sawMounted = true;
      const relativeTop = measureVisibleRelativeTop(target, activeContainer);
      const scrollTop = activeContainer.scrollTop;
      const now = getMonotonicNowMs();

      if (relativeTop !== null) {
        const positionStable =
          stableElement === target &&
          lastRelativeTop !== null &&
          lastScrollTop !== null &&
          Math.abs(relativeTop - lastRelativeTop) <= NATIVE_POSITION_TOLERANCE_PX &&
          Math.abs(scrollTop - lastScrollTop) <= NATIVE_POSITION_TOLERANCE_PX;

        if (!positionStable) {
          stableSince = now;
          stableElement = target;
          lastRelativeTop = relativeTop;
          lastScrollTop = scrollTop;
        } else if (
          stableSince !== null &&
          now - stableSince >= NATIVE_STABLE_WINDOW_MS
        ) {
          return { status: 'settled', element: target, relativeTopPx: relativeTop };
        }
      } else {
        stableSince = null;
        stableElement = null;
        lastRelativeTop = null;
        lastScrollTop = null;
      }
    } else {
      stableSince = null;
      stableElement = null;
      lastRelativeTop = null;
      lastScrollTop = null;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, NATIVE_SETTLE_CHECK_MS);
    });
  }

  if (isCancelled()) {
    return { status: 'cancelled' };
  }

  const finalTarget = findRenderedPrompt(messageId);
  const reason = !sawMounted
    ? 'native-navigation-timeout'
    : finalTarget && finalTarget.isConnected
      ? 'native-target-unstable'
      : 'native-target-disconnected';
  return { status: 'failed', reason };
}

/**
 * Attempts native same-tab SPA message routing when supported by the active
 * platform. Returns `true` if native routing took ownership of the jump
 * (whether it ultimately settles or fails), or `false` if unavailable.
 *
 * @param params Target message, container, cancellation predicate, and callbacks.
 * @returns Whether native SPA message navigation was initiated.
 */
export function tryNativeMessageJump(params: NativeMessageJumpParams): boolean {
  const {
    conversationKey,
    message,
    index,
    jumpId,
    mode,
    container,
    isCancelled,
    onJumpComplete,
    clearJumpProgress,
    onMountFailure,
  } = params;

  const navResult = getActivePlatform().navigation.navigateToMessage?.(
    conversationKey,
    message.id
  );
  if (navResult?.status !== 'ok') {
    return false;
  }

  void waitForNativeLanding(message.id, container, isCancelled).then((outcome) => {
    if (isCancelled() || outcome.status === 'cancelled') return;

    if (outcome.status === 'settled' && outcome.element.isConnected) {
      highlightMatchedElement(outcome.element, message.id);
      keepFollowing(1800);
      logNavigationEvent(jumpId, 'JUMP_FINISHED', {
        status: 'native-settled',
        strategy: 'native-spa',
        relativeTopPx: Math.round(outcome.relativeTopPx),
      });
      if (onJumpComplete) {
        onJumpComplete(index);
      } else {
        clearJumpProgress();
      }
      return;
    }

    const reason =
      outcome.status === 'failed' ? outcome.reason : 'native-target-disconnected';
    logJumpFailedDiagnostic({
      targetIndex: index,
      targetMessageId: message.id,
      reason,
      strategy: 'native-spa',
      recoveryAttempts: 0,
      container: getScrollContainer() ?? container,
    });
    if (mode === 'target-driven') {
      onMountFailure(index);
    }
    logNavigationEvent(jumpId, 'JUMP_FINISHED', {
      status: 'not-found',
      strategy: 'native-spa',
      reason,
    });
  });

  return true;
}
