/** @vitest-environment jsdom */
/** LunaTOC theme markers must not overwrite ChatGPT's host theme state. */
import { afterEach, describe, expect, it } from 'vitest';
import { getLunaTocTheme, setLunaTocTheme } from '@/features/theme/lunaTocTheme';

afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.lunaTocTheme;
});

describe('isolated LunaTOC theme marker', () => {
  it("updates LunaTOC's theme without changing the host page theme", () => {
    document.documentElement.dataset.theme = 'dark';

    setLunaTocTheme('light');

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.lunaTocTheme).toBe('light');
    expect(getLunaTocTheme()).toBe('light');
  });

  it('defaults to dark before LunaTOC theme initialization', () => {
    expect(getLunaTocTheme()).toBe('dark');
  });
});
