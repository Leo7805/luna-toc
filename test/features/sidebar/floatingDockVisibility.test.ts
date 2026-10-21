/**
 * Tests fixed edge dimensions, flush-right sidebar layout and toolbar hit area.
 */
// @ts-expect-error Vitest runs in Node; browser tsconfig intentionally omits Node typings.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../../src/styles/content.css', import.meta.url),
  'utf8'
);

describe('centered reveal handle and sidebar edge alignment', () => {
  it('keeps the empty translucent blue tab at a fixed 5×45px centered position', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\s*\{[^}]*right:\s*0;[^}]*top:\s*50%;[^}]*transform:\s*translateY\(-50%\);[^}]*width:\s*5px;[^}]*height:\s*45px;/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-toggle-btn\s*\{[^}]*width:\s*5px;[^}]*height:\s*45px;[^}]*background:\s*var\(--ct-toggle-btn-hover-bg\);/s
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

  it('aligns the toolbar edge flush-right and fades it without disabling hover', () => {
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*right:\s*0;[^}]*top:\s*50%;[^}]*padding:\s*8px 0 8px 6px;/s
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
});
