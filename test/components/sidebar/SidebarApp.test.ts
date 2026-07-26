/** Tests the static React entry for the ChatGPT page sidebar. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SidebarApp } from '@/components/sidebar/SidebarApp';

describe('SidebarApp', () => {
  it('renders stable slots required by legacy sidebar features', () => {
    const markup = renderToStaticMarkup(
      createElement(SidebarApp, {
        title: 'Conversation <One>',
        emptyHint: 'Waiting for prompts...',
      })
    );

    expect(markup).toContain('id="navigator-resizer"');
    expect(markup).toContain('id="navigator-search"');
    expect(markup).toContain('id="myprompts-toolbar-container"');
    expect(markup).toContain('id="navigator-list"');
    expect(markup).toContain('Conversation &lt;One&gt;');
  });
});
