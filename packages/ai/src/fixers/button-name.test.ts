import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ButtonNameFixer } from './button-name.js';
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

function violation(file?: string, line?: number): A11yViolation {
  return {
    id: 'button-name',
    wcagId: '4.1.2',
    impact: 'serious',
    description: 'Buttons must have discernible text',
    helpUrl: '',
    nodes: [{
      html: '<button><svg/></button>',
      target: ['button'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('ButtonNameFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'btnname-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches axe button-name, not other rules sharing WCAG 4.1.2', () => {
    const fixer = new ButtonNameFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);

    // A different rule sharing WCAG 4.1.2 must not be claimed.
    const other = { ...violation('x.tsx', 1), id: 'aria-props' };
    expect(fixer.canFix(other)).toBe(false);
  });

  it('adds an aria-label to the button on the recorded line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const x = 1;\n<button onClick={close}><Icon /></button>');
    const provider = makeProvider();
    const fixer = new ButtonNameFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const x = 1;'); // line 1 untouched
    expect(contents).toContain('<button aria-label="Close dialog" onClick={close}>');
  });

  it('human-flags when there is no source location', async () => {
    const provider = makeProvider();
    const fixer = new ButtonNameFixer(provider, dir);
    const result = await fixer.fix(violation(undefined, undefined));

    expect(result.bucket).toBe('human-flagged');
    expect(provider.suggestAccessibleName).not.toHaveBeenCalled();
  });

  it('human-flags when the provider is unavailable', async () => {
    const provider = makeProvider({ available: () => false });
    const fixer = new ButtonNameFixer(provider, dir);
    const result = await fixer.fix(violation('x.tsx', 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<button><Icon /></button>');
    const provider = makeProvider({
      suggestAccessibleName: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const fixer = new ButtonNameFixer(provider, dir);

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
    const fixer = new ButtonNameFixer(provider, dir);

    const result = await fixer.fix(violation(missing, 1));

    expect(provider.suggestAccessibleName).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('could not apply');
    expect(result.description).toContain('Close dialog');
  });
});
