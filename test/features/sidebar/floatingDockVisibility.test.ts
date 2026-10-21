/**
 * Verifies the collapsed 10px reveal strip and sidebar-owned centered tools.
 * Actual hover and pinning state transitions are tested in sidebarVisibility.
 */
// @ts-expect-error Vitest runs in Node; the browser tsconfig intentionally omits Node types.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../../src/styles/content.css', import.meta.url),
  'utf8'
);

describe('slim right-edge sidebar trigger', () => {
  it('is 10px wide, keeps the translucent blue background and has no visible text', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\s*\{[^}]*right:\s*0;[^}]*width:\s*10px;[^}]*height:\s*42px;/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-toggle-btn\s*\{[^}]*width:\s*10px;[^}]*height:\s*42px;[^}]*background:\s*var\(--ct-toggle-btn-hover-bg\);/s
    );
    expect(stylesheet).not.toMatch(/#luna-toc-floating-dock::before\s*\{/);
    expect(stylesheet).not.toMatch(/#luna-toc-toggle-btn\s+\.toggle-sidebar-label/);
  });

  it('hides the trigger while the sidebar is open', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\.luna-toc-floating-dock-hidden\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s
    );
  });

  it('positions the three tools vertically centered on the sidebar right edge', () => {
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*position:\s*absolute;[^}]*right:\s*8px;[^}]*top:\s*50%;/s
    );
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*transform:\s*translateY\(-50%\);/s
    );
  });
});
