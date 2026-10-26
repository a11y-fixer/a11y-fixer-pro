import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LinkTextFixer } from './link-text.js';
import type { AIProvider } from '../provider/index.js';
import type { A11yViolation } from '@a11y-fixer/core';

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    available: () => true,
    describeImage: vi.fn(),
    suggestAltText: vi.fn(),
    rewriteLinkText: vi.fn().mockResolvedValue('View pricing details'),
    suggestAccessibleName: vi.fn(),
    ...overrides,
  };
}

function violation(file: string, line: number): A11yViolation {
  return {
    id: 'anchor-has-content',
    wcagId: '2.4.4',
    impact: 'serious',
    description: 'link has no descriptive text',
    helpUrl: '',
    nodes: [{
      html: `${file}:${line}:1`,
      target: ['a'],
      failureSummary: '',
      sourceFile: file,
      sourceLine: line,
      sourceColumn: 1,
    }],
  };
}

describe('LinkTextFixer', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'linktext-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('canFix matches 2.4.4 regardless of provider availability (fix() reports the key)', () => {
    const fixer = new LinkTextFixer(makeProvider(), dir);
    expect(fixer.canFix(violation('x.tsx', 1))).toBe(true);

    const unavailable = new LinkTextFixer(makeProvider({ available: () => false }), dir);
    expect(unavailable.canFix(violation('x.tsx', 1))).toBe(true);
  });

  it('human-flags when the provider is unavailable (no API key)', async () => {
    const provider = makeProvider({ available: () => false });
    const fixer = new LinkTextFixer(provider, dir);
    const result = await fixer.fix(violation('x.tsx', 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.applied).toBe(false);
    expect(result.description).toContain('ANTHROPIC_API_KEY not set');
    expect(provider.rewriteLinkText).not.toHaveBeenCalled();
  });

  it('human-flags when the current link text is not generic', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<a href="/pricing">Our enterprise pricing</a>');
    const provider = makeProvider();
    const fixer = new LinkTextFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));

    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('may not be generic');
    expect(provider.rewriteLinkText).not.toHaveBeenCalled();
  });

  it('rewrites generic link text into the source line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<a href="/pricing">click here</a>');
    const provider = makeProvider();
    const fixer = new LinkTextFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));

    expect(provider.rewriteLinkText).toHaveBeenCalledWith('click here', expect.stringContaining('/pricing'));
    expect(result.applied).toBe(true);
    expect(result.bucket).toBe('ai-assisted');
    expect(result.after).toContain('View pricing details');
    expect(await readFile(file, 'utf8')).toContain('>View pricing details<');
  });

  it('rewrites the anchor on the recorded line, not an unrelated line', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const header = true;\n<a href="/x">click here</a>');
    const provider = makeProvider({ rewriteLinkText: vi.fn().mockResolvedValue('Go to the X page') });
    const fixer = new LinkTextFixer(provider, dir);

    const result = await fixer.fix(violation(file, 2));
    expect(result.applied).toBe(true);
    const contents = await readFile(file, 'utf8');
    expect(contents).toContain('const header = true;'); // line 1 untouched
    expect(contents).toContain('>Go to the X page<');
  });

  it('human-flags when the recorded line has no anchor markup', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, 'const header = true;\n<a href="/x">click here</a>');
    const provider = makeProvider();
    const fixer = new LinkTextFixer(provider, dir);

    // Line 1 has no `>text<`, so there is no generic text to rewrite.
    const result = await fixer.fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(provider.rewriteLinkText).not.toHaveBeenCalled();
  });

  it('human-flags when the AI provider throws', async () => {
    const file = path.join(dir, 'App.tsx');
    await writeFile(file, '<a href="/pricing">click here</a>');
    const provider = makeProvider({
      rewriteLinkText: vi.fn().mockRejectedValue(new Error('rate limited')),
    });
    const fixer = new LinkTextFixer(provider, dir);

    const result = await fixer.fix(violation(file, 1));
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('rate limited');
  });

  it('suggests a rewrite but cannot apply when there is no source location', async () => {
    const provider = makeProvider();
    const fixer = new LinkTextFixer(provider, dir);
    // No sourceFile/sourceLine: markup comes from node.html; nothing to write to.
    const result = await fixer.fix({
      id: 'anchor-has-content',
      wcagId: '2.4.4',
      impact: 'serious',
      description: 'link has no descriptive text',
      helpUrl: '',
      nodes: [{
        html: '<a href="/pricing">click here</a>',
        target: ['a'],
        failureSummary: '',
      }],
    });

    expect(provider.rewriteLinkText).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.bucket).toBe('human-flagged');
    expect(result.description).toContain('Suggested: replace "click here"');
    expect(result.description).toContain('View pricing details');
  });

  it('reports not-applied when the source line no longer contains the text', async () => {
    // sourceFile is set but points at a missing file: markup falls back to
    // node.html (generic, so a rewrite is attempted), but applyLinkTextToSource
    // cannot read the file and returns null, so the fix is not applied.
    const missing = path.join(dir, 'does-not-exist.tsx');
    const provider = makeProvider();
    const fixer = new LinkTextFixer(provider, dir);
    const result = await fixer.fix({
      id: 'anchor-has-content',
      wcagId: '2.4.4',
      impact: 'serious',
      description: 'link has no descriptive text',
      helpUrl: '',
      nodes: [{
        html: '<a href="/pricing">click here</a>',
        target: ['a'],
        failureSummary: '',
        sourceFile: missing,
        sourceLine: 1,
        sourceColumn: 1,
      }],
    });

    expect(provider.rewriteLinkText).toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.after).toBeUndefined();
    expect(result.description).toContain('Rewrote link text');
  });
});
