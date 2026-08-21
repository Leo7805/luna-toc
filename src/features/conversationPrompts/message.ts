/**
 * Converts ChatGPT conversation payloads into ChatTOC's compact message model.
 */
export interface ChatAttachment {
  name?: string;
  mime_type?: string;
  mimeType?: string;
}

export type ChatContentPart = string | { content_type?: string };

export interface ChatMessage {
  id: string;
  author?: { role?: string };
  content?: { parts?: ChatContentPart[] };
  metadata?: { attachments?: ChatAttachment[] };
  create_time?: number;
  createTime?: number;
}

export interface ConversationPageInfo {
  start_cursor?: string;
  end_cursor?: string;
  has_previous_page?: boolean;
  has_next_page?: boolean;
}

export interface ConversationData {
  messages: ChatMessage[];
  current_node?: string | null;
  page_info?: ConversationPageInfo;
}

export interface NavigatorMessage {
  id: string;
  text: string;
  canMatchByText: boolean;
  createTime: number;
}
/**
 * Converts ChatGPT message content and attachments into simple TOC text labels.
 * Non-text parts are kept as readable placeholders so image/file prompts still
 * appear in the navigator.
 * @param {Object} message
 * @returns {string}
 */
export function getMessageDisplayText(message: ChatMessage): string {
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
function getAttachmentDisplayText(file: ChatAttachment): string {
  const label = isImageAttachment(file) ? 'Image' : 'File';

  return `[${label}] ${file.name || 'Uploaded file'}`;
}

/**
 * Formats one ChatGPT content part for display in the navigator.
 * @param {string | Object} part
 * @param {boolean} hasImageAttachment
 * @returns {string}
 */
function getContentPartDisplayText(
  part: ChatContentPart,
  hasImageAttachment: boolean
): string {
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
export function isImageAttachment(file: ChatAttachment): boolean {
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
function getMessageTextParts(message: ChatMessage): string[] {
  return (message.content?.parts || [])
    .filter((part) => typeof part === 'string')
    .map((part) => (part as string).trim())
    .filter(Boolean);
}

/**
 * Returns whether a message contains text that can render in the chat area.
 * @param {Object} message
 * @returns {boolean}
 */
function hasRenderableMessageText(message: ChatMessage): boolean {
  return getMessageTextParts(message).length > 0;
}

/**
 * Returns whether a message has attachments or structured non-text parts.
 * @param {Object} message
 * @returns {boolean}
 */
function hasNonTextMessageContent(message: ChatMessage): boolean {
  const parts = message.content?.parts || [];
  const attachments = message.metadata?.attachments || [];

  return (
    attachments.length > 0 || parts.some((part) => typeof part !== 'string')
  );
}

/**
 * Returns whether DOM text matching is reliable for this prompt.
 * @param {Object} message
 * @returns {boolean}
 */
function isTextMatchableMessage(message: ChatMessage): boolean {
  return (
    hasRenderableMessageText(message) && !hasNonTextMessageContent(message)
  );
}

/**
 * Converts a ChatGPT message into the compact model used by ChatTOC.
 * @param {Object} message
 * @returns {{ id: string, text: string, canMatchByText: boolean, createTime: number }}
 */
export function createNavigatorMessage(message: ChatMessage): NavigatorMessage {
  const text = getMessageDisplayText(message);

  return {
    id: message.id,
    text,
    canMatchByText: isTextMatchableMessage(message),
    createTime: message.create_time ?? message.createTime ?? 0,
  };
}

/**
 * Extracts user prompts from ChatGPT's flat message array in display order.
 * Consecutive user messages (regenerated or stopped versions of the same
 * prompt) collapse to the final one, matching the pre-pagination behavior.
 * @param {Object} data
 * @returns {Object[]}
 */
export function extractUserMessages(
  data: ConversationData | null | undefined
): NavigatorMessage[] {
  const orderedMessages = data?.messages ?? [];
  const messages: NavigatorMessage[] = [];
  let pendingUserMessage: ChatMessage | null = null;

  function flushPendingUserMessage(): void {
    if (!pendingUserMessage) return;

    const navigatorMessage = createNavigatorMessage(pendingUserMessage);

    if (navigatorMessage.text.length > 0) {
      messages.push(navigatorMessage);
    }

    pendingUserMessage = null;
  }

  orderedMessages.forEach((message) => {
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
