/**
 * Tests the 5px full-height edge trigger, right-bottom tools, and row actions.
 */
// @ts-expect-error Vitest runs in Node; browser tsconfig intentionally omits Node typings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../../src/styles/content.css', import.meta.url),
  'utf8'
);

describe('full-height reveal edge and bottom-right sidebar actions', () => {
  it('uses a text-free, 5px-wide, viewport-height reveal strip', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\s*\{[^}]*right:\s*0;[^}]*top:\s*0;[^}]*width:\s*5px;[^}]*height:\s*100vh;/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-toggle-btn\s*\{[^}]*width:\s*5px;[^}]*height:\s*100%;[^}]*background:\s*var\(--ct-toggle-btn-hover-bg\);/s
    );
    expect(stylesheet).not.toMatch(/#luna-toc-floating-dock::before\s*\{/);
  });

  it('makes sidebar content and its scrollbar reach the right viewport edge', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-sidebar\s*\{[^}]*right:\s*0;[^}]*padding:\s*0 0 12px 6px;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-item\s*\{[^}]*padding:\s*7px 0 7px 8px;/s
    );
  });

  it('places controls flush-right at the bottom, retaining the invisible hover hit area', () => {
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*right:\s*0;[^}]*bottom:\s*12px;[^}]*padding:\s*8px 0 8px 6px;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*opacity:\s*0;[^}]*transition:\s*opacity 120ms ease;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\.navigator-jump-controls-visible\s*\{[^}]*opacity:\s*1;/s
    );
    const toolbarBlock = stylesheet.match(/^\.navigator-jump-controls\s*\{([^}]*)\}/m)?.[1];
    expect(toolbarBlock).toBeDefined();
    expect(toolbarBlock).not.toMatch(/pointer-events:\s*none;/);
  });
  it('removes the inline flag while retaining adjacent ellipsis and triangle controls', () => {
    expect(stylesheet).toMatch(/\.navigator-item-menu-btn\s*\{[^}]*width:\s*20px;[^}]*height:\s*24px;/s);
    expect(stylesheet).not.toMatch(/\.navigator-mark-btn\s*\{/);
  });
});
