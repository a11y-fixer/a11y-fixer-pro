import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AreaAltFixer } from './area-alt.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn().mockResolvedValue('Sales region'),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn(),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'area-alt',
    wcagId: 'area-alt',
    impact: 'critical',
    description: 'Active <area> elements must have alternate text',
    helpUrl: '',
    nodes: [{
      html: '<area shape="rect" coords="0,0,80,40" href="/west" />',
      target: ['area'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('AreaAltFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'areaalt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe area-alt, not image-alt', () => {
    const fixer = new AreaAltFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'image-alt' })).toBe(false);
  });

  it('adds an alt attribute to the area and passes href to the provider', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<area shape="rect" coords="0,0,80,40" href="/west" />');
    const provider = makeProvider();
    const fixer = new AreaAltFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));

    expect(provider.suggestAltText).toHaveBeenCalled();
    expect((provider.suggestAltText as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain('/west');
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;');
    expect(contents).toContain('<area alt="Sales region" shape="rect"');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const result = await new AreaAltFixer(provider, dir).fix(violation(undefined, undefined));
    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAltText).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const result = await new AreaAltFixer(makeProvider({ available: () => false }), dir).fix(violation('x.tsx', 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<area href="/west" />');
    const provider = makeProvider({ suggestAltText: vi.fn().mockRejectedValue(new Error('rate limited')) });
    const result = await new AreaAltFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the edit cannot apply', async () => {
    const provider = makeProvider();
    const result = await new AreaAltFixer(provider, dir).fix(violation(path.join(dir, 'nope.tsx'), 1));
    expect(provider.suggestAltText).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Sales region');
  });
});
