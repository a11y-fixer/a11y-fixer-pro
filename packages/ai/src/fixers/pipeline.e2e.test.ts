import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSource } from '@a11y-fixer/core';
import type { A11yViolation } from '@a11y-fixer/core';
import { buildFullRegistry } from './registry.js';
import { AltTextFixer } from './alt-text.js';
import { LinkTextFixer } from './link-text.js';
import { LinkNameFixer } from './link-name.js';
import { ButtonNameFixer } from './button-name.js';
import { FormLabelFixer } from './form-label.js';
import type { AIProvider } from '../provider/index.js';

/**
 * End-to-end coverage of the real fixer pipeline: the actual `@a11y-fixer/core`
 * engine (ESLint scanner, FixerRegistry, addAttributeToElement) wired to the AI
 * fixers via `buildFullRegistry`, driven by a deterministic fake provider.
 *
 * Every other test in the repo that touches scan→fix→rescan mocks core; this one
 * runs core for real against a throwaway JSX fixture on disk. It is hermetic: no
 * Anthropic SDK, no network, no ANTHROPIC_API_KEY, and no browser (the static
 * JSX / ESLint path needs none).
 *
 * Two layers:
 *  1. Full pipeline — real `scanSource` finds violations, `applyAll` fixes them,
 *     a re-scan confirms the fix landed. Only the ESLint-path rules can be
 *     surfaced this way (alt-text, anchor-has-content, heading-has-content).
 *  2. Axe-path fixers (`ButtonNameFixer`/`FormLabelFixer`) key `canFix` off axe
 *     rule ids (`button-name`/`label`) that the static scanner never emits, so
 *     they are driven with representative violations pointing at real fixture
 *     lines — still exercising the real `addAttributeToElement` disk edits and
 *     registry dispatch, just not the real scanner for those two rules.
 */

/** Returns fixed strings so results are deterministic; `available()` is true. */
const fakeProvider: AIProvider = {
  available: () => true,
  describeImage: async () => 'Company logo',
  suggestAltText: async () => 'Company logo',
  rewriteLinkText: async () => 'View the pricing page',
  suggestAccessibleName: async () => 'Submit',
};

// 1-indexed lines are referenced by the synthetic violations below, so keep this
// layout and the line numbers in `nodeAt(...)` in sync.
const FIXTURE = `export default function App() {
  return (
    <div>
      <img src="logo.png" />
      <a href="/pricing"></a>
      <button></button>
      <input type="text" placeholder="Email" />
      <h1></h1>
    </div>
  );
}
`;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'a11y-e2e-'));
  file = join(dir, 'App.tsx');
  await writeFile(file, FIXTURE, 'utf8');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A representative axe-style violation anchored to a real fixture line. */
function violation(id: string, wcagId: string, line: number): A11yViolation {
  return {
    id,
    wcagId,
    impact: 'serious',
    description: id,
    helpUrl: '',
    nodes: [{ html: `${file}:${line}:7`, target: [file], failureSummary: id, sourceFile: file, sourceLine: line, sourceColumn: 7 }],
  };
}

describe('AI fixer pipeline (real core, fake provider)', () => {
  it('scans real JSX, applies an AI alt-text fix to disk, and a re-scan clears it', async () => {
    const before = await scanSource(dir, { html: false });
    // The static ESLint path surfaces these three; axe-only rules do not appear.
    expect(before.map(v => v.wcagId).sort()).toEqual(['1.1.1', '2.4.4', '2.4.6']);

    const registry = buildFullRegistry(fakeProvider, dir);
    const fixes = await registry.applyAll(before);

    const alt = fixes.find(f => f.wcagId === '1.1.1');
    expect(alt).toMatchObject({ applied: true, bucket: 'ai-assisted' });
    expect(alt?.after).toContain('alt="Company logo"');
    expect(alt?.sourceLocation).toMatchObject({ file, line: 4 });

    // The real edit is on disk, not just in the FixResult.
    expect(await readFile(file, 'utf8')).toContain('<img alt="Company logo" src="logo.png" />');

    // Re-scanning the mutated source proves the violation is actually resolved.
    const after = await scanSource(dir, { html: false });
    expect(after.some(v => v.wcagId === '1.1.1')).toBe(false);
    expect(after.length).toBe(before.length - 1);
  });

  it("human-flags an empty anchor rather than inventing link text (generic-text guard)", async () => {
    const before = await scanSource(dir, { html: false });
    const fixes = await buildFullRegistry(fakeProvider, dir).applyAll(before);

    // anchor-has-content fires on an *empty* anchor; its text is not "generic",
    // so LinkTextFixer must flag it for a human instead of applying a rewrite.
    const link = fixes.find(f => f.wcagId === '2.4.4');
    expect(link).toMatchObject({ applied: false, bucket: 'human-flagged' });
  });

  it('dispatches each violation to the right fixer (AI-assisted claim shared WCAG ids)', () => {
    const registry = buildFullRegistry(fakeProvider, dir);
    expect(registry.getFixer(violation('image-alt', '1.1.1', 4))).toBeInstanceOf(AltTextFixer);
    expect(registry.getFixer(violation('anchor-has-content', '2.4.4', 5))).toBeInstanceOf(LinkTextFixer);
    expect(registry.getFixer(violation('button-name', '4.1.2', 6))).toBeInstanceOf(ButtonNameFixer);
    expect(registry.getFixer(violation('link-name', '4.1.2', 5))).toBeInstanceOf(LinkNameFixer);
    expect(registry.getFixer(violation('label', '1.3.1', 7))).toBeInstanceOf(FormLabelFixer);
  });

  it('applies button-name and label aria-labels to disk (axe-path fixers)', async () => {
    const registry = buildFullRegistry(fakeProvider, dir);
    const fixes = await registry.applyAll([
      violation('button-name', '4.1.2', 6),
      violation('label', '1.3.1', 7),
    ]);

    expect(fixes.every(f => f.applied && f.bucket === 'ai-assisted')).toBe(true);

    const src = await readFile(file, 'utf8');
    expect(src).toContain('<button aria-label="Submit"></button>');
    expect(src).toContain('<input aria-label="Submit" type="text" placeholder="Email" />');
  });
});
