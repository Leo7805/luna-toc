/**
 * Owns the Shadow DOM environment that isolates LunaTOC React components,
 * Tailwind styles, and portal content from the host page.
 */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { PromptAutocompleteHost } from '@/components/my-prompts/PromptAutocomplete';
import { PromptEditorDialogHost } from '@/components/my-prompts/PromptEditorDialog';
import {
  SidebarApp,
  type SidebarAppProps,
} from '@/components/sidebar/SidebarApp';
import tailwindCss from '@/styles/tailwind.css?inline';

const REACT_HOST_ID = 'luna-toc-react-host';
const REACT_ROOT_ID = 'luna-toc-react-root';
const PORTAL_ROOT_ID = 'luna-toc-react-portals';

let portalContainer: HTMLDivElement | null = null;
const sidebarRoots = new WeakMap<HTMLElement, Root>();

/**
 * Mounts the React sidebar shell synchronously so legacy controls can bind to
 * its stable light-DOM slots immediately afterward.
 *
 * @example
 * mountSidebarReactApp(sidebar, {
 *   title: 'Conversation',
 *   emptyHint: 'Waiting for prompts...',
 * });
 */
export function mountSidebarReactApp(
  sidebar: HTMLElement,
  props: SidebarAppProps
): void {
  if (sidebarRoots.has(sidebar)) return;

  const root = createRoot(sidebar);
  sidebarRoots.set(sidebar, root);
  flushSync(() => {
    root.render(<SidebarApp {...props} />);
  });
}

/**
 * Creates the isolated React host once the document body is available.
 * Repeated calls are safe because an existing host is left unchanged.
 *
 * @example
 * void initializeReactHost();
 */
export async function initializeReactHost(): Promise<void> {
  await waitForBody();

  if (document.getElementById(REACT_HOST_ID)) return;

  const host = document.createElement('div');
  host.id = REACT_HOST_ID;
  host.style.display = 'contents';
  synchronizeTheme(host);

  const shadowRoot = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = tailwindCss;

  const reactContainer = document.createElement('div');
  reactContainer.id = REACT_ROOT_ID;
  reactContainer.className = 'luna-toc-ui';

  portalContainer = document.createElement('div');
  portalContainer.id = PORTAL_ROOT_ID;
  portalContainer.className = 'luna-toc-ui';

  shadowRoot.append(style, reactContainer, portalContainer);
  document.body.append(host);

  createRoot(reactContainer).render(
    <>
      <PromptAutocompleteHost />
      <PromptEditorDialogHost />
    </>
  );
}

/**
 * Returns the Shadow DOM container used by React portals.
 *
 * @example
 * const container = getReactPortalContainer();
 *
 * @throws {Error} If the React host has not finished initializing.
 */
export function getReactPortalContainer(): HTMLDivElement {
  if (!portalContainer) {
    throw new Error('The LunaTOC React host has not been initialized.');
  }

  return portalContainer;
}

/**
 * Waits for the body because the Content Script starts at document_start.
 */
function waitForBody(): Promise<HTMLElement> {
  return new Promise((resolve) => {
    if (document.body) {
      resolve(document.body);
      return;
    }

    const timer = setInterval(() => {
      if (!document.body) return;
      clearInterval(timer);
      resolve(document.body);
    }, 50);
  });
}

/**
 * Mirrors the document theme onto the host because selectors cannot cross the
 * Shadow DOM boundary from the component stylesheet.
 */
function synchronizeTheme(host: HTMLElement): void {
  const updateTheme = (): void => {
    host.dataset.theme =
      document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  };

  updateTheme();
  new MutationObserver(updateTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
}
