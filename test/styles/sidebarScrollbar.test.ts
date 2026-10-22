/** @vitest-environment node */
/** Guards the TOC-only scrollbar styling while preserving scroll navigation. */
import { beforeAll, describe, expect, it, vi } from 'vitest';

let css = '';
beforeAll(async () => {
  const { readFileSync } = await vi.importActual<{
    readFileSync: (path: URL, encoding: 'utf8') => string;
  }>('node:fs');
  css = readFileSync(new URL('../../src/styles/content.css', import.meta.url), 'utf8');
});

describe('TOC list scrollbar', () => {
  it('hides the track in modern browsers without disabling scrolling', () => {
    expect(css).toMatch(/#navigator-list\s*\{[^}]*overflow-y:\s*auto;/);
    expect(css).toMatch(/#navigator-list\s*\{[^}]*scrollbar-width:\s*none;/);
  });

  it('hides the scrollbar in Chrome and WebKit', () => {
    expect(css).toMatch(/#navigator-list::-webkit-scrollbar\s*\{[^}]*display:\s*none;/);
  });

  it('does not disable scrolling', () => {
    expect(css).not.toMatch(/#navigator-list\s*\{[^}]*overflow-y:\s*hidden;/);
  });
});
