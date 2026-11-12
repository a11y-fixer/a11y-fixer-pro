import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AriaCommandNameFixer } from './aria-command-name.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('Close dialog'),
    ...overrides,
  };
}

function violation(file?: string, line?: number, html = '<div role="button"></div>'): A11yViolation {
  return {
    id: 'aria-command-name',
    wcagId: 'aria-command-name',
    impact: 'serious',
    description: 'ARIA commands must have an accessible name',
    helpUrl: '',
    nodes: [{
      html,
      target: ['div'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('AriaCommandNameFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'cmdname-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe aria-command-name, not button-name', () => {
    const fixer = new AriaCommandNameFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'button-name' })).toBe(false);
  });

  it('adds an aria-label to a role-bearing <div>', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<div role="button" onClick={close}></div>');
    const provider = makeProvider();
    const result = await new AriaCommandNameFixer(provider, dir).fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('<div aria-label="Close dialog" role="button"');
  });

  it('targets a non-default tag derived from the source line (<a role="menuitem">)', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<a role="menuitem" href="#"></a>');
    const result = await new AriaCommandNameFixer(makeProvider(), dir).fix(violation(file, 1, '<a role="menuitem" href="#"></a>'));
    expect(result.applied).toBe(true);
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('<a aria-label="Close dialog" role="menuitem"');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const result = await new AriaCommandNameFixer(provider, dir).fix(violation(undefined, undefined));
    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when no opening tag can be resolved from the line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const handler = close;');
    const provider = makeProvider();
    const result = await new AriaCommandNameFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('opening tag');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const result = await new AriaCommandNameFixer(makeProvider({ available: () => false }), dir).fix(violation('x.tsx', 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<div role="button"></div>');
    const provider = makeProvider({ suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')) });
    const result = await new AriaCommandNameFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the file does not exist (edit cannot apply)', async () => {
    const provider = makeProvider();
    const result = await new AriaCommandNameFixer(provider, dir).fix(violation(path.join(dir, 'nope.tsx'), 1));
    // No file → readSourceLine returns null → markup falls back to node.html
    // (<div role="button">), tag resolves, but the write target doesn't exist.
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Close dialog');
  });
});
