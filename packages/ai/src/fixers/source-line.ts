import { readFile } from 'node:fs/promises';

export interface SourceLineContext {
  /** The trimmed line at `line` (1-indexed). */
  line: string;
  /** A few lines of surrounding context, joined with newlines, for the AI prompt. */
  context: string;
}

/**
 * Reads the source line at `line` (1-indexed) from `file`, plus a small window
 * of surrounding lines for context. Fixers need this because on the ESLint path
 * the violation's `node.html` is a `"file:line:col"` string, not real markup.
 */
export async function readSourceLine(
  file: string,
  line: number,
  window = 2,
): Promise<SourceLineContext | null> {
  try {
    const content = await readFile(file, 'utf8');
    const lines = content.split('\n');
    const idx = line - 1;
    const target = lines[idx];
    if (target === undefined) return null;

    const start = Math.max(0, idx - window);
    const end = Math.min(lines.length, idx + window + 1);
    return {
      line: target.trim(),
      context: lines.slice(start, end).join('\n'),
    };
  } catch {
    return null;
  }
}
