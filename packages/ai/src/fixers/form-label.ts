import type { Fixer, FixResult } from '@a11y-fixer/core';
import type { A11yViolation } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { readSourceLine } from './source-line.js';
import { addAttributeToElement } from '@a11y-fixer/core';

/**
 * Fixes form controls with no associated label (axe `label`, WCAG 1.3.1 / 3.3.2)
 * by adding an AI-generated `aria-label`. aria-label is chosen over wrapping the
 * control in a visible `<label htmlFor>`: wrapping restructures JSX and is risky
 * to apply blindly, whereas aria-label is a safe single-line edit.
 */
export class FormLabelFixer implements Fixer {
  readonly wcagId = '1.3.1';
  readonly bucket = 'ai-assisted' as const;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly rootDir: string,
  ) {}

  canFix(violation: A11yViolation): boolean {
    // Responsibility only — fix() reports the missing-API-key case.
    return violation.id === 'label';
  }

  async fix(violation: A11yViolation): Promise<FixResult> {
    if (!this.aiProvider.available()) {
      return this.humanFlag(violation, 'ANTHROPIC_API_KEY not set — cannot generate form label');
    }

    const node = violation.nodes[0];
    if (!node) return this.humanFlag(violation, 'No node data');

    if (!node.sourceFile || !node.sourceLine) {
      return this.humanFlag(violation, 'No source location to apply an aria-label');
    }

    const source = await readSourceLine(node.sourceFile, node.sourceLine);
    const markup = source?.line ?? node.html;
    const context = source?.context
      ? `Form control: ${source.line}\nSurrounding code:\n${source.context}`
      : `Form control: ${node.html}`;

    let name: string;
    try {
      name = await this.aiProvider.suggestAccessibleName(markup, context);
    } catch (err) {
      return this.humanFlag(violation, `AI provider error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const after = await addAttributeToElement(
      node.sourceFile,
      node.sourceLine,
      /<(?:input|select|textarea)(\s|\/|>)/g,
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
      description: `Added AI-generated form control aria-label: "${name}"`,
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
