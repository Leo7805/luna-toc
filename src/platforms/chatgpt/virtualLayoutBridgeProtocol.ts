/**
 * Shared protocol constants and types for the ChatGPT virtual-layout bridge.
 */

/**
 * Custom event names used for cross-world DOM messaging.
 */
export const CHATGPT_BRIDGE_PROTOCOL = {
  EVENTS: {
    QUERY_REQUEST: '__LUNATOC_CHATGPT_VIRTUAL_LAYOUT_REQ__',
    QUERY_RESPONSE: '__LUNATOC_CHATGPT_VIRTUAL_LAYOUT_RES__',
    HOLD_VIEWPORT_REQUEST: '__LUNATOC_CHATGPT_HOLD_VIEWPORT_REQ__',
    HOLD_VIEWPORT_RESPONSE: '__LUNATOC_CHATGPT_HOLD_VIEWPORT_RES__',
    SCROLL_TO_BOTTOM_REQUEST: '__LUNATOC_CHATGPT_SCROLL_TO_BOTTOM_REQ__',
    SCROLL_TO_BOTTOM_RESPONSE: '__LUNATOC_CHATGPT_SCROLL_TO_BOTTOM_RES__',
  },
} as const;

/**
 * Production request DTO sent from ISOLATED world to MAIN world to invoke
 * ChatGPT's native scroll-to-bottom controller action.
 */
export interface ScrollToBottomBridgeRequest {
  readonly requestId: string;
}

/**
 * Production response DTO returned from MAIN world for a scroll-to-bottom request.
 */
export type ScrollToBottomBridgeResponse =
  | {
      readonly requestId: string;
      readonly status: 'ok';
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason?: string;
    };

/**
 * Production request DTO sent from ISOLATED world to MAIN world to hold the viewport
 * (disarm ChatGPT's bottom-follow controller before intentional navigation).
 */
export interface HoldViewportBridgeRequest {
  readonly requestId: string;
}

/**
 * Production response DTO returned from MAIN world for a hold-viewport request.
 */
export type HoldViewportBridgeResponse =
  | {
      readonly requestId: string;
      readonly status: 'ok';
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason?: string;
    };

/**
 * Production request DTO sent from ISOLATED world to MAIN world.
 */
export interface VirtualLayoutBridgeRequest {
  readonly requestId: string;
  readonly messageId: string;
}

/**
 * Production response DTO returned from MAIN world to ISOLATED world.
 */
export type VirtualLayoutBridgeResponse =
  | {
      readonly requestId: string;
      readonly status: 'ok';
      readonly targetIndex: number;
      readonly topOffsetPx: number;
      readonly turnCount: number;
    }
  | {
      readonly requestId: string;
      readonly status: 'target-not-in-layout';
      readonly turnCount: number;
    }
  | {
      readonly requestId: string;
      readonly status: 'unavailable';
      readonly reason?: string;
    };

/**
 * Generates a unique request correlation ID using crypto.randomUUID with fallback.
 *
 * @returns Unique correlation ID string.
 */
export function createBridgeRequestId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return (
    'req-' +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}
