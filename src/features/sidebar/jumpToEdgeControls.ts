/**
 * Builds and wires the sidebar's "jump to top / bottom" controls.
 *
 * The two buttons live inside the `.navigator-jump-controls` cluster that
 * `FloatingPanel` drags; the view-mode toggle in between is owned by
 * `sidebarController`. This module owns the top/bottom buttons' DOM, their
 * click/double-click handlers, and the view-mode branch that decides whether
 * they scroll the chat feed or the sidebar's own prompt list.
 */
import { navigatorController } from '@/navigation/navigatorController';

type ConversationEdge = 'top' | 'bottom';

/**
 * Creates the jump-to-edge buttons inside the existing `.navigator-jump-controls`
 * cluster and wires their click handlers.
 *
 * @param {() => boolean} isMyPromptsView Reports whether the sidebar is
 *   currently showing the My Prompts view.
 * @returns {HTMLElement} The `.navigator-jump-controls` cluster.
 */
export function createJumpToEdgeControls(
  isMyPromptsView: () => boolean
): HTMLElement {
  const cluster = document.querySelector<HTMLElement>(
    '.navigator-jump-controls'
  );
  if (!cluster) {
    throw new Error('Jump control cluster (.navigator-jump-controls) not found');
  }

  const topButton = createJumpButton('top');
  const bottomButton = createJumpButton('bottom');

  // Keep the original visual order: top → view-mode toggle → bottom.
  cluster.prepend(topButton);
  cluster.append(bottomButton);

  topButton.addEventListener('click', () =>
    handleJumpControlClick('top', isMyPromptsView)
  );
  topButton.addEventListener('dblclick', () =>
    handleJumpControlDoubleClick('top', isMyPromptsView)
  );
  bottomButton.addEventListener('click', () =>
    handleJumpControlClick('bottom', isMyPromptsView)
  );
  bottomButton.addEventListener('dblclick', () =>
    handleJumpControlDoubleClick('bottom', isMyPromptsView)
  );

  return cluster;
}

/**
 * Scrolls the My Prompts list to one of its absolute edges.
 */
export function scrollNavigatorListToEdge(
  edge: ConversationEdge,
  behavior: ScrollBehavior = 'smooth'
): void {
  const list = document.getElementById('navigator-list');
  if (!list) return;
  list.scrollTo({
    top: edge === 'top' ? 0 : list.scrollHeight,
    behavior,
  });
}

/**
 * Builds a single jump button with its directional icon.
 * @param {'top' | 'bottom'} edge
 * @returns {HTMLButtonElement}
 */
function createJumpButton(edge: ConversationEdge): HTMLButtonElement {
  const button = document.createElement('button');
  const isTop = edge === 'top';

  button.className = 'navigator-icon-btn';
  button.id = isTop ? 'jump-chat-top-btn' : 'jump-chat-bottom-btn';
  button.type = 'button';
  button.setAttribute('aria-label', isTop ? 'Jump to top' : 'Jump to bottom');
  button.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="${isTop ? 'M6 5h12M12 19V9M7 14l5-5 5 5' : 'M6 19h12M12 5v10M7 10l5 5 5-5'}" />
    </svg>
  `;

  return button;
}

function handleJumpControlClick(
  edge: ConversationEdge,
  isMyPromptsView: () => boolean
): void {
  if (isMyPromptsView()) {
    scrollNavigatorListToEdge(edge, 'smooth');
    return;
  }
  navigatorController.jumpToEdge(edge);
}

function handleJumpControlDoubleClick(
  edge: ConversationEdge,
  isMyPromptsView: () => boolean
): void {
  if (isMyPromptsView()) {
    scrollNavigatorListToEdge(edge, 'auto');
    return;
  }
  navigatorController.jumpToAbsoluteEdge(edge);
}
