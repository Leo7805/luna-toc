/**
 * Prevents regressions where the collapsed floating dock is visually absent.
 * The browser smoke-check separately verifies actual pointer hit testing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../../src/styles/content.css', import.meta.url),
  'utf8'
);

describe('collapsed directory dock visual affordance', () => {
  it('has a readable, hoverable button-height edge tab when the moon is retracted', () => {
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock\s*\{[^}]*right:\s*-26px;[^}]*width:\s*42px;[^}]*height:\s*42px;/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock::before\s*\{[^}]*content:\s*'目录';[^}]*left:\s*-16px;[^}]*width:\s*32px;[^}]*height:\s*42px;[^}]*background:\s*var\(--ct-toggle-btn-color\);/s
    );
    expect(stylesheet).toMatch(
      /#luna-toc-floating-dock:hover::before,[\s\S]*?pointer-events:\s*none;/s
    );
    expect(stylesheet).not.toMatch(/#luna-toc-floating-dock\s*\{[^}]*height:\s*100(?:d?vh);/s);
  });

  it('keeps the pop-out controls aligned with the moon rather than the sidebar', () => {
    expect(stylesheet).toMatch(
      /\.navigator-jump-controls\s*\{[^}]*position:\s*absolute;[^}]*right:\s*100%;[^}]*top:\s*50%;/s
    );
  });
});
