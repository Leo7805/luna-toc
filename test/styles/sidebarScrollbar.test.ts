/** @vitest-environment node */
/** Guards the TOC-only scrollbar styling while preserving scroll navigation. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles/content.css', import.meta.url), 'utf8');

describe('TOC list scrollbar', () => {
  it('hides the track in modern browsers without disabling scrolling', () => {
    expect(css).toMatch(/#navigator-list\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/#navigator-list\s*\{[^}]*scrollbar-width:\s*none;/);
  });

  it('hides the scrollbar in Chrome and WebKit', () => {
    expect(css).toMatch(/#navigator-list::-webkit-scrollbar\s*\{[^}]*display:\s*none;/);
  });

  it('does not change unrelated scroll surfaces', () => {
    expect(css).not.toMatch(/#navigator-list\s*\{[^}]*overflow-y:\s*hidden;/);
  });
});
