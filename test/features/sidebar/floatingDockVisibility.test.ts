/**
 * Tests the borderless 6px light-blue edge, bottom tools, and row actions.
 */
// @ts-expect-error Vitest runs in Node; browser tsconfig intentionally omits Node typings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../../src/styles/content.css', import.meta.url),
  'utf8'
);

describe('full-height reveal edge and bottom-right sidebar actions', () => {
  it('uses a uniform translucent light-blue borderless 6px viewport-height strip', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\s*\{[^}]*right:\s*0;[^}]*top:\s*0;[^}]*width:\s*6px;[^}]*height:\s*100vh;/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-toggle-btn\s*\{[^}]*width:\s*6px;[^}]*height:\s*100%;[^}]*background:\s*var\(--ct-toggle-btn-hover-bg\);/s
    );
    expect(stylesheet).not.toMatch(/#luna-toc-floating-dock::before\s*\{/);
    const handle = stylesheet.match(/^#luna-toc-toggle-btn\s*\{([^}]*)\}/m)?.[1];
    expect(handle).toMatch(/border:\s*0;/);
    expect(handle).not.toMatch(/border-left|box-shadow|background-image/);
    expect(stylesheet).toMatch(/--ct-toggle-btn-hover-bg:\s*rgba\(147, 197, 253, 0\.35\);/);
  });

  it('makes sidebar content and its scrollbar reach the right viewport edge', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-sidebar\s*\{[^}]*right:\s*0;[^}]*padding:\s*0 0 12px 6px;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-item\s*\{[^}]*padding:\s*7px 0 7px 6px;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-item-index\s*\{[^}]*flex:\s*0 0 auto;[^}]*width:\s*auto;[^}]*text-align:\s*left;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-item-text\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;/s
    );
  });

  it('shows a 2px translucent reveal strip across only the stacked button height', () => {
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*right:\s*0;[^}]*bottom:\s*12px;[^}]*padding:\s*8px 0 8px 6px;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls::after\s*\{[^}]*top:\s*9px;[^}]*bottom:\s*9px;[^}]*width:\s*2px;[^}]*background:\s*var\(--ct-jump-reveal-bg\);/s
    );
    expect(stylesheet).toMatch(
      /--ct-jump-reveal-bg:\s*rgba\(3, 10, 23, 0\.3\);/
    );
    expect(stylesheet).toMatch(
      /--ct-jump-reveal-bg:\s*rgba\(141, 164, 197, 0\.23\);/
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\.navigator-jump-controls-visible::after\s*\{[^}]*opacity:\s*0;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls > button\s*\{[^}]*opacity:\s*0;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\.navigator-jump-controls-visible > button\s*\{[^}]*opacity:\s*1;/s
    );

    const base = stylesheet.match(/^\.navigator-jump-controls\s*\{([^}]*)\}/m)?.[1];
    expect(base).toBeDefined();
    expect(base).not.toMatch(/opacity:\s*0;|pointer-events:\s*none;/);
  });

  it('removes inline action buttons; truncation is purely CSS-driven', () => {
    expect(stylesheet).not.toMatch(/\.navigator-item-menu-btn\s*\{/);
    expect(stylesheet).not.toMatch(/\.navigator-mark-btn\s*\{/);
    expect(stylesheet).not.toMatch(/\.navigator-outline-indicator\s*\{/);
  });
});
