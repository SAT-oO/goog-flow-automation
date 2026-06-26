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

/**
 * Character spans for each parsed prompt block in the original textarea value.
 * Used to scroll/select the matching paragraph when a queue item is opened.
 */
export function getPromptBlockSpans(text) {
  const prompts = parsePrompts(text);
  if (!prompts.length) return [];

  const raw = (text || "").replace(/\r\n/g, "\n");
  const spans = [];
  let searchFrom = 0;

  for (const prompt of prompts) {
    let needle = prompt;
    let idx = raw.indexOf(needle, searchFrom);
    if (idx === -1) {
      needle = prompt.trim();
      idx = raw.indexOf(needle, searchFrom);
    }
    if (idx === -1) {
      spans.push(null);
      continue;
    }
    spans.push({ start: idx, end: idx + needle.length });
    searchFrom = idx + needle.length;
  }

  return spans;
}
