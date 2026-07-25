/** @vitest-environment jsdom */
/** Tests the opt-in Outline diagnostic logger. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logOutlineDiagnostic } from '@/features/navigation/outlineDiagnostics';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('outline diagnostics', () => {
  it('logs only when the runtime switch is enabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});

    logOutlineDiagnostic('OUTLINE_TEST', { promptIndex: 1 });
    expect(debug).not.toHaveBeenCalled();

    localStorage.setItem('chatTocDebugOutline', '1');
    logOutlineDiagnostic('OUTLINE_TEST', { promptIndex: 1 });

    expect(debug).toHaveBeenCalledWith(
      '[LunaTOC outline] OUTLINE_TEST',
      { promptIndex: 1 }
    );
  });
});
