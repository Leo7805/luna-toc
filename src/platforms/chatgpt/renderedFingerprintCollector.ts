/**
 * Collects stabilized ChatGPT Assistant DOM text as observed fingerprints.
 */
import { APP_CONFIG } from '@/config/config';
import { normalizeComparableText } from '@/navigation/fingerprint/comparableText';
import { createResponseFingerprints } from '@/navigation/fingerprint/generator';
import type { ResponseFingerprintRecord } from '@/navigation/fingerprint/index';
import { getRenderedAssistantTextBlocks } from './renderedTextAdapter';

export interface RenderedFingerprintContext {
  conversationKey: string;
  revision: number;
  responsePromptIndexes: ReadonlyMap<string, number>;
}

export interface RenderedFingerprintCollectorOptions {
  debounceMs?: number;
  onFingerprintRecord: (
    context: RenderedFingerprintContext,
    record: ResponseFingerprintRecord
  ) => void;
}

export interface RenderedFingerprintCollector {
  collect(root?: ParentNode): Promise<void>;
  observe(root?: HTMLElement): void;
  setContext(context: RenderedFingerprintContext | null): void;
  disconnect(): void;
}

/**
 * Creates a debounced collector that upgrades derived fingerprints with text
 * observed from ChatGPT's rendered Assistant DOM.
 *
 * @example
 * const collector = createRenderedFingerprintCollector({
 *   onFingerprintRecord: (context, record) => storeRecord(context, record),
 * });
 * collector.setContext({ conversationKey, revision, responsePromptIndexes });
 * collector.observe(document.body);
 */
export function createRenderedFingerprintCollector({
  debounceMs = APP_CONFIG.navigation.fingerprint.observationDebounceMs,
  onFingerprintRecord,
}: RenderedFingerprintCollectorOptions): RenderedFingerprintCollector {
  let context: RenderedFingerprintContext | null = null;
  let observedRoot: HTMLElement | null = null;
  let observer: MutationObserver | null = null;
  let collectionTimer: ReturnType<typeof setTimeout> | null = null;
  const collectedTextByResponse = new Map<string, string>();

  function setContext(nextContext: RenderedFingerprintContext | null): void {
    context = nextContext;
    collectedTextByResponse.clear();
    scheduleCollection();
  }

  async function collect(root: ParentNode = document): Promise<void> {
    const collectionContext = context;

    if (!collectionContext) return;

    for (const block of getRenderedAssistantTextBlocks(root)) {
      const promptIndex = collectionContext.responsePromptIndexes.get(block.id);
      const comparableText = normalizeComparableText(block.text);

      if (promptIndex === undefined || !comparableText) continue;
      if (collectedTextByResponse.get(block.id) === comparableText) continue;

      const fingerprints = await createResponseFingerprints({
        id: block.id,
        text: block.text,
      });

      if (fingerprints.length === 0) continue;

      collectedTextByResponse.set(block.id, comparableText);
      onFingerprintRecord(collectionContext, {
        responseId: block.id,
        promptIndex,
        quality: 'observed',
        fingerprints,
      });
    }
  }

  function scheduleCollection(): void {
    if (!context || !observedRoot) return;
    if (collectionTimer !== null) clearTimeout(collectionTimer);

    collectionTimer = setTimeout(() => {
      collectionTimer = null;
      const collectionRoot = observedRoot;
      if (collectionRoot) void collect(collectionRoot);
    }, Math.max(0, debounceMs));
  }

  function observe(root: HTMLElement = document.body): void {
    observer?.disconnect();
    observedRoot = root;
    observer = new MutationObserver(scheduleCollection);
    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    scheduleCollection();
  }

  function disconnect(): void {
    observer?.disconnect();
    observer = null;
    observedRoot = null;
    context = null;
    collectedTextByResponse.clear();

    if (collectionTimer !== null) {
      clearTimeout(collectionTimer);
      collectionTimer = null;
    }
  }

  return {
    collect,
    observe,
    setContext,
    disconnect,
  };
}
