/**
 * Starts LunaTOC's legacy DOM application and isolated React UI environment
 * from the Chrome Content Script entry.
 */
import { initializeApplication } from '@/app/applicationShell';
import { observeExternalOverlays } from '@/features/externalOverlay';
import { startPageHookMismatchBridge, startChatGptConfigSync } from '@/features/contractAlert/pageHookBridge';
import { initializeReactHost } from '@/reactHost/reactHost';

// Start the existing sidebar and browser-integration features.
void initializeApplication();

// Prepare the Shadow DOM boundary used by current and future React interfaces.
void initializeReactHost();

// Forward page-hook contract-mismatch messages into the ISOLATED-world detector.
startPageHookMismatchBridge();

// Sync the active contract values to the MAIN-world page-hook so its detection
// compares observed paths against the developer's current expectations.
startChatGptConfigSync();

// Keep host-page fullscreen media controls above every LunaTOC surface.
void waitForBody().then(() => observeExternalOverlays());

function waitForBody(): Promise<HTMLElement> {
  return new Promise((resolve) => {
    if (document.body) {
      resolve(document.body);
      return;
    }

    const timer = setInterval(() => {
      if (!document.body) return;
      clearInterval(timer);
      resolve(document.body);
    }, 50);
  });
}
