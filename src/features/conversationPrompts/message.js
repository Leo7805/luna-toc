/**
 * Converts ChatGPT conversation payloads into ChatTOC's compact message model.
 */
(function () {
  /**
   * Converts ChatGPT message content and attachments into simple TOC text labels.
   * Non-text parts are kept as readable placeholders so image/file prompts still
   * appear in the navigator.
   * @param {Object} message
   * @returns {string}
   */
  function getMessageDisplayText(message) {
    const parts = message.content?.parts || [];
    const attachments = message.metadata?.attachments || [];
    const hasImageAttachment = attachments.some(isImageAttachment);
    const attachmentParts = attachments.map(getAttachmentDisplayText);
    const textParts = parts
      .map((part) => getContentPartDisplayText(part, hasImageAttachment))
      .filter(Boolean);

    return [...attachmentParts, ...textParts].join('\n').trim();
  }

  /**
   * Formats one uploaded attachment for display in the navigator.
   * @param {Object} file
   * @returns {string}
   */
  function getAttachmentDisplayText(file) {
    const label = isImageAttachment(file) ? 'Image' : 'File';

    return `[${label}] ${file.name || 'Uploaded file'}`;
  }

  /**
   * Formats one ChatGPT content part for display in the navigator.
   * @param {string | Object} part
   * @param {boolean} hasImageAttachment
   * @returns {string}
   */
  function getContentPartDisplayText(part, hasImageAttachment) {
    if (typeof part === 'string') {
      return part.trim();
    }

    if (part?.content_type === 'image_asset_pointer') {
      return hasImageAttachment ? '' : '[Image]';
    }

    if (part?.content_type) {
      return `[${part.content_type}]`;
    }

    return '[Attachment]';
  }

  /**
   * Returns whether an uploaded attachment should be labeled as an image.
   * @param {Object} file
   * @returns {boolean}
   */
  function isImageAttachment(file) {
    const mimeType = file.mime_type || file.mimeType || '';
    const name = file.name || '';

    return (
      mimeType.startsWith('image/') ||
      /\.(apng|avif|gif|jpe?g|png|svg|webp)$/i.test(name)
    );
  }

  /**
   * Returns non-empty string parts from a ChatGPT message.
   * @param {Object} message
   * @returns {string[]}
   */
  function getMessageTextParts(message) {
    return (message.content?.parts || [])
      .filter((part) => typeof part === 'string')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  /**
   * Returns whether a message contains text that can render in the chat area.
   * @param {Object} message
   * @returns {boolean}
   */
  function hasRenderableMessageText(message) {
    return getMessageTextParts(message).length > 0;
  }

  /**
   * Returns whether a message has attachments or structured non-text parts.
   * @param {Object} message
   * @returns {boolean}
   */
  function hasNonTextMessageContent(message) {
    const parts = message.content?.parts || [];
    const attachments = message.metadata?.attachments || [];

    return (
      attachments.length > 0 ||
      parts.some((part) => typeof part !== 'string')
    );
  }

  /**
   * Returns whether DOM text matching is reliable for this prompt.
   * @param {Object} message
   * @returns {boolean}
   */
  function isTextMatchableMessage(message) {
    return (
      hasRenderableMessageText(message) &&
      !hasNonTextMessageContent(message)
    );
  }

  /**
   * Converts a ChatGPT message into the compact model used by ChatTOC.
   * @param {Object} message
   * @returns {{ id: string, text: string, canMatchByText: boolean, createTime: number }}
   */
  function createNavigatorMessage(message) {
    const text = getMessageDisplayText(message);

    return {
      id: message.id,
      text,
      canMatchByText: isTextMatchableMessage(message),
      createTime: message.create_time ?? message.createTime ?? 0,
    };
  }

  /**
   * Walks the current conversation branch from current_node back to the root.
   * ChatGPT's mapping can contain alternate branches, so this avoids listing
   * prompts outside the active branch.
   * @param {Object} data
   * @returns {Object[]}
   */
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

  /**
   * Extracts user prompts from ChatGPT's conversation payload in display order.
   * @param {Object} data
   * @returns {Object[]}
   */
  function extractUserMessages(data) {
    if (!data || !data.mapping) {
      return [];
    }

    const orderedNodes = getOrderedConversationNodes(data);
    const messages = [];
    let pendingUserMessage = null;

    function flushPendingUserMessage() {
      if (!pendingUserMessage) return;

      const navigatorMessage = createNavigatorMessage(pendingUserMessage);

      if (navigatorMessage.text.length > 0) {
        messages.push(navigatorMessage);
      }

      pendingUserMessage = null;
    }

    orderedNodes.forEach((node) => {
      const message = node.message;
      const role = message?.author?.role;

      if (!role) return;

      if (role === 'user') {
        pendingUserMessage = message;
        return;
      }

      flushPendingUserMessage();
    });

    flushPendingUserMessage();

    return messages;
  }

  window.ChatTocMessages = {
    createNavigatorMessage,
    extractUserMessages,
    getMessageDisplayText,
    isImageAttachment,
  };
})();
