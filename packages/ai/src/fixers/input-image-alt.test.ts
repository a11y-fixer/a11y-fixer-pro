import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InputImageAltFixer } from './input-image-alt.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn().mockResolvedValue('Search'),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn(),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'input-image-alt',
    wcagId: 'input-image-alt',
    impact: 'critical',
    description: 'Image buttons must have alternate text',
    helpUrl: '',
    nodes: [{
      html: '<input type="image" src="/search.png" />',
      target: ['input'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('InputImageAltFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'inimgalt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe input-image-alt, not image-alt', () => {
    const fixer = new InputImageAltFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);

    const other = { ...violation('x.tsx', 1), id: 'image-alt' };
    expect(fixer.canFix(other)).toBe(false);
  });

  it('adds an alt attribute to the input on the recorded line and passes src to the provider', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<input type="image" src="/search.png" />');
    const provider = makeProvider();
    const fixer = new InputImageAltFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));

    expect(provider.suggestAltText).toHaveBeenCalled();
    expect((provider.suggestAltText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/search.png');
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;');
    expect(contents).toContain('<input alt="Search" type="image" src="/search.png" />');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const fixer = new InputImageAltFixer(provider, dir);
    const result = await fixer.fix(violation(undefined, undefined));

    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAltText).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const provider = makeProvider({ available: () => false });
    const fixer = new InputImageAltFixer(provider, dir);
    const result = await fixer.fix(violation('x.tsx', 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<input type="image" src="/search.png" />');
    const provider = makeProvider({
      suggestAltText: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const fixer = new InputImageAltFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the edit cannot apply', async () => {
    const missing = path.join(dir, 'does-not-exist.tsx');
    const provider = makeProvider();
    const fixer = new InputImageAltFixer(provider, dir);

    const result = await fixer.fix(violation(missing, 1));

    expect(provider.suggestAltText).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Search');
  });
});
