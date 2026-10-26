import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSourceLine } from './source-line.js';

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map(d => rm(d, { recursive: true, force: true })));
});

async function withFile(content: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'source-line-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'Component.tsx');
  await writeFile(file, content);
  return file;
}

const SRC = ['line one', '  line two', 'line three', 'line four', 'line five'].join('\n');

describe('readSourceLine', () => {
  it('returns the trimmed target line (1-indexed)', async () => {
    const file = await withFile(SRC);
    const result = await readSourceLine(file, 2);
    expect(result?.line).toBe('line two');
  });

  it('includes a window of surrounding lines in context', async () => {
    const file = await withFile(SRC);
    const result = await readSourceLine(file, 3, 1);
    expect(result?.context).toBe(['  line two', 'line three', 'line four'].join('\n'));
  });

  it('clamps the context window at the start of the file', async () => {
    const file = await withFile(SRC);
    const result = await readSourceLine(file, 1, 2);
    expect(result?.context).toBe(['line one', '  line two', 'line three'].join('\n'));
  });

  it('clamps the context window at the end of the file', async () => {
    const file = await withFile(SRC);
    const result = await readSourceLine(file, 5, 2);
    expect(result?.context).toBe(['line three', 'line four', 'line five'].join('\n'));
  });

  it('returns null when the line is out of range', async () => {
    const file = await withFile(SRC);
    expect(await readSourceLine(file, 99)).toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    expect(await readSourceLine(path.join(tmpdir(), 'nope-xyz.tsx'), 1)).toBeNull();
  });
});
