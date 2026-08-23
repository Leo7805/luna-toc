/**
 * Renders the top-most compatibility-alert modal on chatgpt.com when the
 * developer has enabled `showCompatibilityAlert` in the Options page and the
 * detector has at least one pending mismatch record.
 *
 * Renders nothing when the toggle is off or no mismatches are pending, so
 * end users (and disabled developers) never see the alert.
 */
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  loadChatGptRuntimeConfig,
  type ChatGptRuntimeConfig,
} from '@/config/config';
import { getReactPortalContainer } from '@/reactHost/reactHost';
import {
  COMPATIBILITY_ALERT_BODY,
  COMPATIBILITY_ALERT_DETAILS_EXPECTED,
  COMPATIBILITY_ALERT_DETAILS_OBSERVED,
  COMPATIBILITY_ALERT_DETAILS_SUMMARY,
  COMPATIBILITY_ALERT_DISMISS,
  COMPATIBILITY_ALERT_TITLE,
} from './copy';
import {
  dismissAllMismatches,
  dismissMismatch,
  getPendingMismatches,
  subscribeMismatches,
  type MismatchRecord,
} from './detector';

/** Highest representable z-index so the dialog sits above any host overlay. */
const ALERT_Z_INDEX = 2147483647;

/**
 * Drop-in component. Mount it once near the top of the content-script React
 * tree; it manages its own subscription to the detector and to runtime
 * config.
 */
export function ContractAlert(): React.ReactElement | null {
  const [records, setRecords] = useState<MismatchRecord[]>([]);
  const [runtime, setRuntime] = useState<ChatGptRuntimeConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadChatGptRuntimeConfig().then((cfg) => {
      if (!cancelled) setRuntime(cfg);
    });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: chrome.storage.AreaName
    ): void => {
      if (areaName !== 'local') return;
      if (!('chatGptRuntimeConfig' in changes)) return;
      void loadChatGptRuntimeConfig().then((cfg) => {
        if (!cancelled) setRuntime(cfg);
      });
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    return subscribeMismatches((next) => {
      setRecords(next);
    });
  }, []);

  if (!runtime?.showCompatibilityAlert) return null;
  if (records.length === 0) return null;

  const handleDismissAll = (): void => {
    dismissAllMismatches();
  };

  const zClass = `z-[${ALERT_Z_INDEX}]`;
  const portalContainer = getReactPortalContainer();

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleDismissAll(); }}>
      <DialogContent
        portalContainer={portalContainer}
        overlayClassName={zClass}
        className={`${zClass} sm:max-w-lg`}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{COMPATIBILITY_ALERT_TITLE}</DialogTitle>
          {records.length > 1 ? (
            <DialogDescription>
              {`${records.length} ChatGPT contracts appear to have changed. Each is listed below.`}
            </DialogDescription>
          ) : (
            <DialogDescription>
              {COMPATIBILITY_ALERT_BODY.replace(
                '{label}',
                records[0]?.label ?? ''
              )}
            </DialogDescription>
          )}
        </DialogHeader>

        <ul className="m-0 flex max-h-[60vh] flex-col gap-3 overflow-y-auto p-0">
          {records.map((record) => (
            <li
              key={record.contractId}
              className="rounded-lg border border-foreground/10 bg-background p-3"
            >
              <p className="m-0 text-sm text-foreground">
                {COMPATIBILITY_ALERT_BODY.replace('{label}', record.label)}
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted-foreground select-none">
                  {COMPATIBILITY_ALERT_DETAILS_SUMMARY}
                </summary>
                <div className="mt-2 font-mono text-xs break-all text-foreground/80">
                  <div>
                    <strong>{COMPATIBILITY_ALERT_DETAILS_EXPECTED}:</strong>{' '}
                    {record.expected}
                  </div>
                  <div className="mt-1">
                    <strong>{COMPATIBILITY_ALERT_DETAILS_OBSERVED}:</strong>{' '}
                    {record.actual}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 h-auto p-0 text-xs text-primary hover:underline"
                  onClick={() => dismissMismatch(record.contractId)}
                >
                  Dismiss this entry
                </Button>
              </details>
            </li>
          ))}
        </ul>

        <DialogFooter showCloseButton={false}>
          <Button variant="outline" onClick={handleDismissAll}>
            {COMPATIBILITY_ALERT_DISMISS}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { getPendingMismatches };