/**
 * Thin re-export shim. The ChatGPT theme detector lives at
 * `src/platforms/chatgpt/theme.ts` so the platform aggregator can wire it
 * into `Platform.theme`. This file preserves the original import path so
 * popup code keeps working.
 */
export {
  getResolvedTheme as getChatGPTTheme,
  observeTheme as observeChatGPTTheme,
  writeResolvedTheme as writeResolvedChatGPTTheme,
  readResolvedTheme as readResolvedChatGPTTheme,
  subscribeResolvedTheme as subscribeResolvedChatGPTTheme,
  type ResolvedTheme,
} from '@/platforms/chatgpt/theme';