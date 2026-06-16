console.log('ChatGPT Conversation Navigator loaded');

// const collectedMessages = new Map();
let conversationMessages = [];
let tooltipHideTimer = null;

/**
 * Injects pageHook.js into the real page context.
 * Content scripts run in an isolated world, so we need this injected script
 * to hook the page's own fetch calls.
 */
function injectFetchHook() {
  const script = document.createElement('script');

  script.src = chrome.runtime.getURL('pageHook.js');

  script.onload = () => {
    script.remove(); // Clean up after execution
  };

  document.documentElement.appendChild(script);
}

// async function fetchCurrentConversation() {
//   const match = location.pathname.match(/\/c\/([^/]+)/);
//   const conversationId = match?.[1];

//   if (!conversationId) {
//     console.log('[Navigator] no conversation id in url');
//     return;
//   }

//   const url = `/backend-api/conversation/${conversationId}`;

//   console.log('[Navigator] manual fetch:', url);

//   const res = await fetch(url);

//   if (!res.ok) {
//     console.warn('[Navigator] manual fetch failed:', res.status, url);
//     return;
//   }

//   const data = await res.json();
//   const messages = extractUserMessages(data);

//   buildNavigator(messages);
// }

// async function fetchCurrentConversation() {
//   const match = location.pathname.match(/\/c\/([^/]+)/);
//   const conversationId = match?.[1];

//   if (!conversationId) {
//     console.log('[Navigator] no conversation id in url');
//     return;
//   }

//   const url = `/backend-api/conversation/${conversationId}`;

//   console.log('[Navigator] manual fetch:', url);

//   try {
//     const res = await fetch(url);

//     if (!res.ok) {
//       console.warn('[Navigator] manual fetch failed:', res.status);
//       return;
//     }

//     const data = await res.json();
//     const messages = extractUserMessages(data);

//     // updateNavigator('manual-fetch', messages);
//     buildNavigator(messages);
//   } catch (error) {
//     console.warn('[Navigator] manual fetch error:', error);
//   }
// }

/**
 * Listens for URL changes to detect when the user switches conversations or starts a new one.
 */
// function listenForUrlChanges() {
//   let lastUrl = location.href;

//   setInterval(() => {
//     if (location.href !== lastUrl) {
//       lastUrl = location.href;
//       console.log('[Navigator] url changed:', lastUrl);
//       fetchCurrentConversation();
//     }
//   }, 500);
// }

function waitForBody() {
  return new Promise((resolve) => {
    if (document.body) {
      resolve(document.body);
      return;
    }

    const timer = setInterval(() => {
      if (document.body) {
        clearInterval(timer);
        resolve(document.body);
      }
    }, 50);
  });
}

/**
 * Creates the floating sidebar.
 */
async function createSidebar() {
  await waitForBody();

  const sidebar = document.createElement('div');

  sidebar.id = 'conversation-navigator-sidebar';

  sidebar.innerHTML = `
  <h2>Conversation Navigator</h2>
  <button id="refresh-toc-btn">Refresh TOC</button>
	  <p class="navigator-hint">
	    Waiting for conversation data...
	  </p>
	  <div id="navigator-list"></div>
	`;

  document.body.appendChild(sidebar);
  document
    .getElementById('refresh-toc-btn')
    .addEventListener('click', reloadCurrentPageData);

  return sidebar;
}

function reloadCurrentPageData() {
  location.reload();
}

function createTooltip() {
  if (document.getElementById('navigator-tooltip')) return;

  const tooltip = document.createElement('div');

  tooltip.id = 'navigator-tooltip';
  document.body.appendChild(tooltip);
}

/**
 * Creates the floating toggle button.
 */
function createToggleButton(sidebar) {
  const toggleBtn = document.createElement('button');

  toggleBtn.id = 'toggle-sidebar-btn';
  toggleBtn.innerHTML = '☰';

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('navigator-hidden');
  });

  document.body.appendChild(toggleBtn);
}

function getMessageDisplayText(message) {
  const content = message.content;
  const parts = content?.parts || [];
  const attachments = message.metadata?.attachments || [];

  const textParts = parts
    .map((part) => {
      if (typeof part === 'string') {
        return part.trim();
      }

      if (part?.content_type === 'image_asset_pointer') {
        return '[Image]';
      }

      if (part?.content_type) {
        return `[${part.content_type}]`;
      }

      return '';
    })
    .filter(Boolean);

  const attachmentParts = attachments.map((file) => {
    return `[File] ${file.name || 'Uploaded file'}`;
  });

  return [...attachmentParts, ...textParts].join('\n').trim();
}

function getOrderedConversationNodes(data) {
  const mapping = data.mapping;
  const orderedNodes = [];

  let currentNodeId = data.current_node;

  while (currentNodeId) {
    const node = mapping[currentNodeId];

    if (!node) break;

    orderedNodes.push(node);

    currentNodeId = node.parent;
  }

  return orderedNodes.reverse();
}

function extractUserMessages(data) {
  if (!data || !data.mapping) {
    console.warn('Invalid conversation data received');
    return [];
  }

  const orderedNodes = getOrderedConversationNodes(data);

  return orderedNodes
    .filter((node) => node.message?.author?.role === 'user')
    .map((node) => {
      const message = node.message;
      const text = getMessageDisplayText(message);

      return {
        id: message.id,
        text,
        createTime: message.create_time ?? 0,
      };
    })
    .filter((message) => message.text.length > 0);
}

/**
 * Builds the sidebar list from conversationMessages.
 */
function buildNavigator() {
  const list = document.getElementById('navigator-list');
  const hint = document.querySelector('.navigator-hint');

  if (!list) return;

  list.innerHTML = '';

  if (hint) {
    hint.textContent = `${conversationMessages.length} user messages found.`;
  }

  // conversationMessages.forEach((message, index) => {
  //   const fullText = message.text.replace(/\s+/g, ' ');

  //   const item = document.createElement('div');

  //   item.className = 'navigator-item';
  //   item.textContent = `${index + 1}. ${fullText}`;

  //   item.addEventListener('click', () => {
  //     jumpToPromptByIndex(index);
  //   });

  //   item.addEventListener('mouseenter', (event) => {
  //     showTooltip(message.text, event);
  //   });

  //   item.addEventListener('mouseleave', () => {
  //     hideTooltip();
  //   });

  //   list.appendChild(item);
  // });

  conversationMessages.forEach((message, index) => {
    const fullText = message.text.replace(/\s+/g, ' ');
    const shortTitle =
      fullText.length > 40 ? `${fullText.slice(0, 40)}...` : fullText;

    const item = document.createElement('div');

    item.className = 'navigator-item';
    item.textContent = `${index + 1}. ${shortTitle}`;
    item.title = fullText;

    // item.addEventListener('click', () => {
    //   jumpToMessage(message.id);
    // });
    // item.addEventListener('click', () => {
    //   jumpToPromptByIndex(index);
    // });
    item.addEventListener('click', () => {
      jumpToUserMessageByText(message.text, index);
    });

    item.addEventListener('mouseenter', (event) => {
      showTooltip(message.text, event);
    });

    item.addEventListener('mouseleave', () => {
      hideTooltip();
    });

    list.appendChild(item);
  });
}

function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function jumpToUserMessageByText(text, index) {
  const targetText = normalizeText(text);

  const userMessageElements = Array.from(
    document.querySelectorAll('[data-message-author-role="user"]')
  );

  const matchedElement = userMessageElements.find((element) => {
    const domText = normalizeText(element.innerText);

    return domText.includes(targetText) || targetText.includes(domText);
  });

  if (matchedElement) {
    matchedElement.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });

    matchedElement.style.outline = '2px solid #60a5fa';
    matchedElement.style.borderRadius = '8px';

    setTimeout(() => {
      matchedElement.style.outline = '';
      matchedElement.style.borderRadius = '';
    }, 1200);

    return;
  }

  console.log('[Navigator] Text match failed, fallback to prompt index:', {
    index,
    text,
  });

  jumpToPromptByIndex(index);
}

function showTooltip(text, event) {
  const tooltip = document.getElementById('navigator-tooltip');

  if (!tooltip) return;

  clearTimeout(tooltipHideTimer);
  tooltipHideTimer = null;

  tooltip.textContent = text;
  tooltip.classList.add('visible');

  const gap = 8;
  const margin = 16;
  const sidebar = document.getElementById('conversation-navigator-sidebar');
  const sidebarRect = sidebar?.getBoundingClientRect();

  let y = event.clientY + 15;

  const rect = tooltip.getBoundingClientRect();
  const x = sidebarRect
    ? Math.max(margin, sidebarRect.left - rect.width - gap)
    : Math.max(margin, event.clientX - rect.width - gap);

  if (y + rect.height > window.innerHeight) {
    y = window.innerHeight - rect.height - margin;
  }

  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  const tooltip = document.getElementById('navigator-tooltip');

  if (!tooltip) return;

  clearTimeout(tooltipHideTimer);

  tooltipHideTimer = setTimeout(() => {
    tooltip.classList.remove('visible');
    tooltipHideTimer = null;
  }, 200);
}

function initTooltip() {
  const tooltip = document.getElementById('navigator-tooltip');

  if (!tooltip) return;

  tooltip.addEventListener('mouseenter', () => {
    clearTimeout(tooltipHideTimer);
  });

  tooltip.addEventListener('mouseleave', () => {
    hideTooltip();
  });
}

/**
 * Handles conversation data sent from pageHook.js.
 */
function handleConversationData(data) {
  if (!data || !data.mapping) {
    return;
  }

  conversationMessages = extractUserMessages(data);

  console.log('✅ [Navigator] update navigator', conversationMessages.length);

  buildNavigator();
}

/**
 * Listens for messages sent from pageHook.js.
 */
function listenForConversationData() {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'CHATGPT_CONVERSATION_DATA') {
      handleConversationData(event.data.payload);
    }

    if (event.data?.type === 'CHATGPT_NEW_USER_MESSAGE') {
      const newMessage = event.data.payload;

      console.log(
        '[Navigator] Captured input message:',
        newMessage.content?.parts?.join('\n')
      );
      console.log('[Navigator] New user message:', newMessage);
      console.log('[Navigator] before:', conversationMessages.length);

      const exists = conversationMessages.some(
        (message) => message.id === newMessage.id
      );

      if (!exists) {
        // conversationMessages.push(newMessage);
        const rawText =
          newMessage.text || newMessage.content?.parts?.join('\n') || '';

        const normalizedMessage = {
          id: newMessage.id,
          text: rawText.trim(),
          createTime: newMessage.create_time ?? Date.now(),
        };

        conversationMessages.push(normalizedMessage);
        buildNavigator();

        console.log('❤️[Navigator] after:', conversationMessages.length);
        buildNavigator();
      } else {
        console.log('❤️[Navigator] duplicate message ignored');
      }
    }
    // ❤️ End Test
  });
}

// function jumpToPromptByIndex(index) {
//   const buttons = Array.from(
//     document.querySelectorAll('[aria-label^="Prompt"]')
//   );

//   const button = buttons[index];

//   if (!button) {
//     console.log('Prompt button not found:', index + 1);
//     return;
//   }

//   button.click();
// }

function jumpToPromptByIndex(index) {
  const buttons = Array.from(
    document.querySelectorAll('[aria-label^="Prompt"]')
  );

  const button = buttons[index];

  if (button) {
    button.click();
    return;
  }

  jumpToUserMessageFallback(index);
}

function jumpToUserMessageFallback(index) {
  const messages = Array.from(
    document.querySelectorAll('[data-message-author-role="user"]')
  );

  const message = messages[index];

  if (!message) {
    console.log('[Navigator] User message not found:', index + 1);
    return;
  }

  message.scrollIntoView({
    behavior: 'smooth',
    block: 'start',
  });
}

async function main() {
  injectFetchHook(); // Start intercepting conversation data
  // fetchCurrentConversation(); // Fetch current conversation data on load (in case we missed it in the hook)
  // listenForUrlChanges(); // Listen for URL changes to detect conversation switches

  listenForConversationData(); // Listen for data sent from the fetch hook

  const sidebar = await createSidebar();

  createToggleButton(sidebar);

  createTooltip();
  initTooltip();
}

main();
