import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LinkNameFixer } from './link-name.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn(),
    suggestAccessibleName: vi.fn().mockResolvedValue('View pricing'),
    ...overrides,
  };
}

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'link-name',
    wcagId: '4.1.2',
    impact: 'serious',
    description: 'Links must have discernible text',
    helpUrl: '',
    nodes: [{
      html: '<a href="/pricing"><svg/></a>',
      target: ['a'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('LinkNameFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'linkname-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe link-name, not other rules sharing WCAG 4.1.2 or anchor rules', () => {
    const fixer = new LinkNameFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);

    // button-name also maps to WCAG 4.1.2 but is a different fixer's job.
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'button-name' })).toBe(false);
    // link-text (anchor-has-content, 2.4.4) must not be claimed here either.
    expect(fixer.canFix({ ...violation('x.tsx', 1), id: 'anchor-has-content', wcagId: '2.4.4' })).toBe(false);
  });

  it('adds an aria-label to the anchor on the recorded line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<a href="/pricing"><Icon /></a>');
    const provider = makeProvider();
    const fixer = new LinkNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;'); // line 1 untouched
    expect(contents).toContain('<a aria-label="View pricing" href="/pricing">');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const fixer = new LinkNameFixer(provider, dir);
    const result = await fixer.fix(violation(undefined, undefined));

    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const provider = makeProvider({ available: () => false });
    const fixer = new LinkNameFixer(provider, dir);
    const result = await fixer.fix(violation('x.tsx', 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<a href="/x"><Icon /></a>');
    const provider = makeProvider({
      suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const fixer = new LinkNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('falls back to node.html context and flags when the edit cannot apply', async () => {
    // sourceFile points at a path that does not exist: readSourceLine returns
    // null (so context falls back to node.html), and addAttributeToElement
    // cannot read the file, so the fix is flagged rather than applied.
    const missing = path.join(dir, 'does-not-exist.tsx');
    const provider = makeProvider();
    const fixer = new LinkNameFixer(provider, dir);

    const result = await fixer.fix(violation(missing, 1));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('View pricing');
  });
});
