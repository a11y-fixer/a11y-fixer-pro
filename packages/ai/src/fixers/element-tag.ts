/**
 * Builds an opening-tag regex for the element described by `markup`.
 *
 * Role-based axe rules (aria-command-name, aria-input-field-name,
 * aria-toggle-field-name) fire on any element that carries a given ARIA role —
 * `<div role="button">`, `<a role="menuitem">`, `<span role="switch">`, … — so a
 * fixer can't hardcode a single tag regex the way the tag-specific fixers do.
 * This derives the regex from the first tag name on the source line, matching
 * the shape the tag-specific fixers pass to `addAttributeToElement`
 * (`/<tag(\s|>)/g`).
 *
 * Returns `null` when no opening tag can be found (e.g. the recorded line is a
 * `file:line:col` placeholder or the tag opens on another line); callers
 * human-flag in that case.
 */
export function openingTagRegex(markup: string): RegExp | null {
  const match = markup.match(/<([a-zA-Z][\w-]*)/);
  const tag = match?.[1];
  if (!tag) return null;
  // Escape nothing special: tag names are [A-Za-z][\w-]*, all regex-safe.
  return new RegExp(`<${tag}(\\s|>)`, 'g');
}
