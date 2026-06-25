/**
 * Parse prompt text into an array of prompts.
 * Supports:
 *  - One prompt per paragraph (blank line separated)
 *  - One prompt per line when no blank lines are present
 */
export function parsePrompts(text) {
  const normalized = (text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const hasParagraphBreaks = /\n\s*\n/.test(normalized);
  const rawBlocks = hasParagraphBreaks
    ? normalized.split(/\n\s*\n+/)
    : normalized.split("\n");

  return rawBlocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
}

export function sanitizeFolderName(name) {
  const trimmed = (name || "flow-images").trim() || "flow-images";
  return trimmed.replace(/[\\/:*?"<>|]/g, "_").replace(/^\.+/, "_");
}
