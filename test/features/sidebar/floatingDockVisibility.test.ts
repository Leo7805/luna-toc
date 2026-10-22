/**
 * Tests the invisible 6px activation edge, pointer-positioned tools, and row actions.
 */
// @ts-expect-error Vitest runs in Node; browser tsconfig intentionally omits Node typings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../../src/styles/content.css', import.meta.url),
  'utf8'
);

describe('full-height reveal edge and pointer-positioned sidebar actions', () => {
  it('keeps a 6px full-height pointer target with a configurable tint', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\s*\{[^}]*right:\s*0;[^}]*top:\s*0;[^}]*width:\s*6px;[^}]*height:\s*100vh;/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-toggle-btn\s*\{[^}]*width:\s*6px;[^}]*height:\s*100%;[^}]*background:\s*var\(--luna-toc-reveal-bg, transparent\);/s
    );
    expect(stylesheet).not.toMatch(/#luna-toc-floating-dock::before\s*\{/);
    const handle = stylesheet.match(/^#luna-toc-toggle-btn\s*\{([^}]*)\}/m)?.[1];
    expect(handle).toMatch(/border:\s*0;/);
    expect(handle).not.toMatch(/border-left|box-shadow|background-image/);
    expect(stylesheet).not.toMatch(/#luna-toc-toggle-btn:hover\s*,/);
    expect(handle).not.toMatch(/opacity:|background-image|background-color/);
    expect(stylesheet).not.toMatch(/#luna-toc-toggle-btn:hover\s*,/);
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

  it('keeps navigation controls hidden until the pointer reaches the edge', () => {
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*right:\s*0;[^}]*top:\s*50%;[^}]*bottom:\s*auto;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls:not\(\.navigator-jump-controls-visible\)\s*\{[^}]*pointer-events:\s*none;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls > button\s*\{[^}]*opacity:\s*0;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\.navigator-jump-controls-visible > button\s*\{[^}]*opacity:\s*1;/s
    );
    expect(stylesheet).not.toMatch(/\.navigator-jump-controls::after\s*\{/);
    expect(stylesheet).not.toMatch(/\.navigator-jump-controls\s*\{[^}]*bottom:\s*12px;/s);
  });

  it('uses the legacy translucent default background and retains the faster close transition', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-sidebar\.luna-toc-navigator-ready\s*\{[^}]*transition:\s*transform 100ms ease;/s
    );
    expect(stylesheet).toMatch(/--ct-bg-sidebar:\s*rgba\(16, 24, 39, 0\.85\);/);
    expect(stylesheet).toMatch(/--ct-bg-sidebar:\s*rgba\(238, 245, 255, 0\.85\);/);
    expect(stylesheet).toMatch(/#luna-toc-sidebar\s*\{[^}]*backdrop-filter:\s*blur\(12px\);/s);
    expect(stylesheet).not.toMatch(/#luna-toc-sidebar\.luna-toc-sidebar-transparent\s*\{/);
  });

  it('removes inline action buttons; truncation is purely CSS-driven', () => {
    expect(stylesheet).not.toMatch(/\.navigator-item-menu-btn\s*\{/);
    expect(stylesheet).not.toMatch(/\.navigator-mark-btn\s*\{/);
    expect(stylesheet).not.toMatch(/\.navigator-outline-indicator\s*\{/);
  });
});
