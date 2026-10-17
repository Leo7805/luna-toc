/**
 * Internal developer configuration for navigation jump strategies.
 */

/**
 * Strategy-specific configuration options.
 */
export interface JumpStrategyConfig {
  viewportWalker: {
    readonly stepViewports: number;
  };
  virtualLayout: {
    readonly enabled: boolean;
    readonly mountTimeoutMs: number;
  };
}

/**
 * Default internal settings for jump strategies.
 */
export const JUMP_STRATEGY_CONFIG: JumpStrategyConfig = {
  viewportWalker: {
    stepViewports: 1, // Normal walking travel distance in viewports per step
  },
  virtualLayout: {
    enabled: true,
    mountTimeoutMs: 1000,
  },
};
