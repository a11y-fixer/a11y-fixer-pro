import type { Fixer, FixResult } from '@a11y-fixer/core';
import type { A11yViolation } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { readSourceLine } from './source-line.js';
import { addAttributeToElement } from '@a11y-fixer/core';

/**
 * Fixes `<svg role="img">` graphics with no accessible text (axe `svg-img-alt`,
 * WCAG 1.1.1) by adding an AI-generated `aria-label`. An `<svg>` exposes its
 * name via `aria-label`/`<title>` rather than `alt`, so this uses
 * `suggestAccessibleName` and a safe single-line aria-label edit on the opening
 * tag; it never injects a `<title>` child (which would be a multi-line
 * restructure). If the `<svg>` opening tag isn't on the recorded line, the edit
 * can't apply and the fixer human-flags.
 *
 * Kept separate from {@link AltTextFixer} (the broad WCAG 1.1.1 fixer) so it can
 * key on the specific axe id and own its own tag regex — see the registry
 * ordering note.
 */
export class SvgImgAltFixer implements Fixer {
  readonly wcagId = '1.1.1';
  readonly bucket = 'ai-assisted' as const;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly rootDir: string,
  ) {}

  canFix(violation: A11yViolation): boolean {
    // Key on the axe rule id: core leaves `svg-img-alt` out of AXE_WCAG_MAP, so
    // violation.wcagId is the raw id rather than the shared 1.1.1.
    return violation.id === 'svg-img-alt';
  }

  async fix(violation: A11yViolation): Promise<FixResult> {
    if (!this.aiProvider.available()) {
      return this.humanFlag(violation, 'ANTHROPIC_API_KEY not set — cannot generate svg label');
    }

    const node = violation.nodes[0];
    if (!node) return this.humanFlag(violation, 'No node data');

    if (!node.sourceFile || !node.sourceLine) {
      return this.humanFlag(violation, 'No source location to apply an aria-label');
    }

    const source = await readSourceLine(node.sourceFile, node.sourceLine);
    const markup = source?.line ?? node.html;
    const context = source?.context
      ? `SVG graphic: ${source.line}\nSurrounding code:\n${source.context}`
      : `SVG graphic: ${node.html}`;

    let name: string;
    try {
      name = await this.aiProvider.suggestAccessibleName(markup, context);
    } catch (err) {
      return this.humanFlag(violation, `AI provider error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const after = await addAttributeToElement(
      node.sourceFile,
      node.sourceLine,
      /<svg(\s|>)/g,
      'aria-label',
      name,
    );

    if (after === null) {
      return this.humanFlag(violation, `Suggested aria-label "${name}" — could not apply to source`);
    }

    return {
      wcagId: this.wcagId,
      bucket: 'ai-assisted',
      applied: true,
      description: `Added AI-generated svg aria-label: "${name}"`,
      before: markup,
      after,
      sourceLocation: { file: node.sourceFile, line: node.sourceLine, column: node.sourceColumn ?? 1 },
    };
  }

  private humanFlag(violation: A11yViolation, note: string): FixResult {
    return {
      wcagId: this.wcagId,
      bucket: 'human-flagged',
      applied: false,
      description: note,
      before: violation.nodes[0]?.html ?? '',
      humanNote: note,
    };
  }
}
