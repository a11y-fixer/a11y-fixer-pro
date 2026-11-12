import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ObjectAltFixer } from './object-alt.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('Quarterly report'),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'object-alt',
    wcagId: 'object-alt',
    impact: 'serious',
    description: '<object> elements must have alternate text',
    helpUrl: '',
    nodes: [{
      html: '<object data="/report.pdf" type="application/pdf"></object>',
      target: ['object'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('ObjectAltFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'objalt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe object-alt, not image-alt', () => {
    const fixer = new ObjectAltFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'image-alt' })).toBe(false);
  });

  it('adds an aria-label to the object on the recorded line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<object data="/report.pdf" type="application/pdf"></object>');
    const provider = makeProvider();
    const result = await new ObjectAltFixer(provider, dir).fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;');
    expect(contents).toContain('<object aria-label="Quarterly report" data="/report.pdf"');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const result = await new ObjectAltFixer(provider, dir).fix(violation(undefined, undefined));
    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const result = await new ObjectAltFixer(makeProvider({ available: () => false }), dir).fix(violation('x.tsx', 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<object data="/report.pdf"></object>');
    const provider = makeProvider({ suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')) });
    const result = await new ObjectAltFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the edit cannot apply', async () => {
    const provider = makeProvider();
    const result = await new ObjectAltFixer(provider, dir).fix(violation(path.join(dir, 'nope.tsx'), 1));
    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Quarterly report');
  });
});
