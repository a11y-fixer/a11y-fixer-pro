import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AriaInputFieldNameFixer } from './aria-input-field-name.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('Search query'),
    ...overrides,
  };
}

function violation(file?: string, line?: number, html = '<div role="textbox" contentEditable></div>'): A11yViolation {
  return {
    id: 'aria-input-field-name',
    wcagId: 'aria-input-field-name',
    impact: 'serious',
    description: 'ARIA input fields must have an accessible name',
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

describe('AriaInputFieldNameFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'inpfield-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe aria-input-field-name, not label', () => {
    const fixer = new AriaInputFieldNameFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'label' })).toBe(false);
  });

  it('adds an aria-label to a role-bearing <div>', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<div role="textbox" contentEditable></div>');
    const provider = makeProvider();
    const result = await new AriaInputFieldNameFixer(provider, dir).fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('<div aria-label="Search query" role="textbox"');
  });

  it('targets a non-default tag derived from the source line (<span role="combobox">)', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<span role="combobox" tabIndex={0}></span>');
    const result = await new AriaInputFieldNameFixer(makeProvider(), dir).fix(violation(file, 1, '<span role="combobox"></span>'));
    expect(result.applied).toBe(true);
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('<span aria-label="Search query" role="combobox"');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const result = await new AriaInputFieldNameFixer(provider, dir).fix(violation(undefined, undefined));
    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when no opening tag can be resolved from the line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const value = state;');
    const provider = makeProvider();
    const result = await new AriaInputFieldNameFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('opening tag');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const result = await new AriaInputFieldNameFixer(makeProvider({ available: () => false }), dir).fix(violation('x.tsx', 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<div role="textbox"></div>');
    const provider = makeProvider({ suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')) });
    const result = await new AriaInputFieldNameFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the file does not exist (edit cannot apply)', async () => {
    const provider = makeProvider();
    const result = await new AriaInputFieldNameFixer(provider, dir).fix(violation(path.join(dir, 'nope.tsx'), 1));
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Search query');
  });
});
