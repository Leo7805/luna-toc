/** Owns the isolated theme marker used only by LunaTOC content-script UI. */
import type { ResolvedTheme } from './themeSettings';

/** Applies LunaTOC's theme without modifying the host page's theme marker. */
export function setLunaTocTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.lunaTocTheme = theme;
}

/** Returns LunaTOC's theme marker, defaulting to dark before initialization. */
export function getLunaTocTheme(
  root: HTMLElement = document.documentElement
): ResolvedTheme {
  return root.dataset.lunaTocTheme === 'light' ? 'light' : 'dark';
}
