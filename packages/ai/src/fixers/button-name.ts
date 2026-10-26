import type { Fixer, FixResult } from '@a11y-fixer/core';
import type { A11yViolation } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { readSourceLine } from './source-line.js';
import { addAttributeToElement } from '@a11y-fixer/core';

/**
 * Fixes buttons with no accessible name (axe `button-name`, WCAG 4.1.2) — most
 * often icon-only buttons — by adding an AI-generated `aria-label`. Adding
 * aria-label is a safe single-line edit; it never restructures JSX.
 */
export class ButtonNameFixer implements Fixer {
  readonly wcagId = '4.1.2';
  readonly bucket = 'ai-assisted' as const;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly rootDir: string,
  ) {}

  canFix(violation: A11yViolation): boolean {
    // Responsibility only — fix() reports the missing-API-key case.
    return violation.id === 'button-name';
  }

  async fix(violation: A11yViolation): Promise<FixResult> {
    if (!this.aiProvider.available()) {
      return this.humanFlag(violation, 'ANTHROPIC_API_KEY not set — cannot generate button label');
    }

    const node = violation.nodes[0];
    if (!node) return this.humanFlag(violation, 'No node data');

    if (!node.sourceFile || !node.sourceLine) {
      return this.humanFlag(violation, 'No source location to apply an aria-label');
    }

    const source = await readSourceLine(node.sourceFile, node.sourceLine);
    const markup = source?.line ?? node.html;
    const context = source?.context
      ? `Button element: ${source.line}\nSurrounding code:\n${source.context}`
      : `Button element: ${node.html}`;

    let name: string;
    try {
      name = await this.aiProvider.suggestAccessibleName(markup, context);
    } catch (err) {
      return this.humanFlag(violation, `AI provider error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const after = await addAttributeToElement(
      node.sourceFile,
      node.sourceLine,
      /<button(\s|>)/g,
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
      description: `Added AI-generated button aria-label: "${name}"`,
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
