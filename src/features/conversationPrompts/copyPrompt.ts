/**
 * Copies the full text of a TOC prompt from a direct user interaction.
 * Uses the Clipboard API first and a selection-based fallback when unavailable.
 */

/**
 * Copies prompt text so it can be pasted into another input immediately.
 * @throws Error when neither browser clipboard mechanism succeeds.
 */
export async function copyPromptText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback supports pages where Clipboard API access is restricted.
    }
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.readOnly = true;
  input.style.position = 'fixed';
  input.style.left = '-9999px';
  document.body.appendChild(input);

  try {
    input.focus();
    input.select();
    if (!document.execCommand?.('copy')) {
      throw new Error('Unable to copy the prompt to the clipboard.');
    }
  } finally {
    input.remove();
  }
}
