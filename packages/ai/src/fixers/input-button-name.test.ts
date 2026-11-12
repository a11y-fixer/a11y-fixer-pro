import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InputButtonNameFixer } from './input-button-name.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('Submit order'),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'input-button-name',
    wcagId: 'input-button-name',
    impact: 'serious',
    description: 'Input buttons must have discernible text',
    helpUrl: '',
    nodes: [{
      html: '<input type="submit" />',
      target: ['input'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('InputButtonNameFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'inbtnname-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe input-button-name, not other rules', () => {
    const fixer = new InputButtonNameFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);

    const other = { ...violation('x.tsx', 1), id: 'button-name' };
    expect(fixer.canFix(other)).toBe(false);
  });

  it('adds an aria-label to the input on the recorded line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<input type="submit" />');
    const provider = makeProvider();
    const fixer = new InputButtonNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;');
    expect(contents).toContain('<input aria-label="Submit order" type="submit" />');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const fixer = new InputButtonNameFixer(provider, dir);
    const result = await fixer.fix(violation(undefined, undefined));

    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const provider = makeProvider({ available: () => false });
    const fixer = new InputButtonNameFixer(provider, dir);
    const result = await fixer.fix(violation('x.tsx', 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<input type="submit" />');
    const provider = makeProvider({
      suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const fixer = new InputButtonNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the edit cannot apply', async () => {
    const missing = path.join(dir, 'does-not-exist.tsx');
    const provider = makeProvider();
    const fixer = new InputButtonNameFixer(provider, dir);

    const result = await fixer.fix(violation(missing, 1));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Submit order');
  });
});
