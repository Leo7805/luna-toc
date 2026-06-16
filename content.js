console.log('ChatGPT Conversation Navigator loaded');

const collectedMessages = new Map();

function createSidebar() {
  const sidebar = document.createElement('div');

  sidebar.id = 'conversation-navigator-sidebar';
  sidebar.innerHTML = `
    <h2>Conversation Navigator</h2>
    <button id="scan-dom-btn">Scan DOM</button>
    <p class="navigator-hint">
      Only currently rendered messages can be scanned.
    </p>
    <div id="navigator-list"></div>
  `;

  document.body.appendChild(sidebar);

  return sidebar;
}

function createToggleButton(sidebar) {
  const toggleBtn = document.createElement('button');

  toggleBtn.id = 'toggle-sidebar-btn';
  toggleBtn.innerHTML = '☰';

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('hidden');
  });

  document.body.appendChild(toggleBtn);
}

function getVisibleUserMessages() {
  return Array.from(
    document.querySelectorAll('[data-message-author-role="user"]')
  );
}

function scanDomMessages() {
  collectedMessages.clear();

  const messages = getVisibleUserMessages();

  messages.forEach((msg, index) => {
    const text = msg.innerText.trim();

    if (!text) return;

    collectedMessages.set(`${index}-${text}`, {
      text,
      element: msg,
    });
  });

  buildNavigator();
}

function buildNavigator() {
  const list = document.getElementById('navigator-list');

  list.innerHTML = '';

  const messages = Array.from(collectedMessages.values());

  messages.forEach(({ text, element }, index) => {
    const title = text.slice(0, 50);

    const item = document.createElement('div');
    item.className = 'navigator-item';
    item.textContent = `${index + 1}. ${title}`;

    item.addEventListener('click', () => {
      element.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });

    list.appendChild(item);
  });
}

function main() {
  const sidebar = createSidebar();

  createToggleButton(sidebar);

  document
    .getElementById('scan-dom-btn')
    .addEventListener('click', scanDomMessages);

  scanDomMessages();
}

main();
