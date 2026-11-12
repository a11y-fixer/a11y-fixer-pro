import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SelectNameFixer } from './select-name.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('Country'),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'select-name',
    wcagId: 'select-name',
    impact: 'serious',
    description: 'Select element must have an accessible name',
    helpUrl: '',
    nodes: [{
      html: '<select><option>US</option></select>',
      target: ['select'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('SelectNameFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'selname-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe select-name, not other rules', () => {
    const fixer = new SelectNameFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);

    const other = { ...violation('x.tsx', 1), id: 'label' };
    expect(fixer.canFix(other)).toBe(false);
  });

  it('adds an aria-label to the select on the recorded line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<select name="country"><option>US</option></select>');
    const provider = makeProvider();
    const fixer = new SelectNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;');
    expect(contents).toContain('<select aria-label="Country" name="country">');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const fixer = new SelectNameFixer(provider, dir);
    const result = await fixer.fix(violation(undefined, undefined));

    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const provider = makeProvider({ available: () => false });
    const fixer = new SelectNameFixer(provider, dir);
    const result = await fixer.fix(violation('x.tsx', 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<select><option>US</option></select>');
    const provider = makeProvider({
      suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const fixer = new SelectNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the edit cannot apply', async () => {
    const missing = path.join(dir, 'does-not-exist.tsx');
    const provider = makeProvider();
    const fixer = new SelectNameFixer(provider, dir);

    const result = await fixer.fix(violation(missing, 1));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Country');
  });
});
