import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SvgImgAltFixer } from './svg-img-alt.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('Company logo'),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'svg-img-alt',
    wcagId: 'svg-img-alt',
    impact: 'serious',
    description: '<svg> elements with an img role must have alternate text',
    helpUrl: '',
    nodes: [{
      html: '<svg role="img"><path d="M0 0h10v10H0z" /></svg>',
      target: ['svg'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('SvgImgAltFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'svgalt-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe svg-img-alt, not image-alt', () => {
    const fixer = new SvgImgAltFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'image-alt' })).toBe(false);
  });

  it('adds an aria-label to the svg on the recorded line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<svg role="img"><path d="M0 0h10v10H0z" /></svg>');
    const provider = makeProvider();
    const result = await new SvgImgAltFixer(provider, dir).fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;');
    expect(contents).toContain('<svg aria-label="Company logo" role="img">');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const result = await new SvgImgAltFixer(provider, dir).fix(violation(undefined, undefined));
    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const result = await new SvgImgAltFixer(makeProvider({ available: () => false }), dir).fix(violation('x.tsx', 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<svg role="img"></svg>');
    const provider = makeProvider({ suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')) });
    const result = await new SvgImgAltFixer(provider, dir).fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('flags when the edit cannot apply', async () => {
    const provider = makeProvider();
    const result = await new SvgImgAltFixer(provider, dir).fix(violation(path.join(dir, 'nope.tsx'), 1));
    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Company logo');
  });
});
