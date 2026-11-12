import type { Fixer, FixResult } from '@a11y-fixer/core';
import type { A11yViolation } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { readSourceLine } from './source-line.js';
import { addAttributeToElement } from '@a11y-fixer/core';

/**
 * Fixes `<object>` embeds with no text alternative (axe `object-alt`, WCAG
 * 1.1.1) by adding an AI-generated `aria-label`. Unlike `<img>`, an `<object>`
 * takes its accessible name from `aria-label`/inner content rather than an
 * `alt` attribute, so this uses `suggestAccessibleName` and a safe single-line
 * aria-label edit; it never restructures the element.
 *
 * Kept separate from {@link AltTextFixer} (the broad WCAG 1.1.1 fixer) so it can
 * key on the specific axe id and own its own tag regex — see the registry
 * ordering note.
 */
export class ObjectAltFixer implements Fixer {
  readonly wcagId = '1.1.1';
  readonly bucket = 'ai-assisted' as const;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly rootDir: string,
  ) {}

  canFix(violation: A11yViolation): boolean {
    // Key on the axe rule id: core leaves `object-alt` out of AXE_WCAG_MAP, so
    // violation.wcagId is the raw id rather than the shared 1.1.1.
    return violation.id === 'object-alt';
  }

  async fix(violation: A11yViolation): Promise<FixResult> {
    if (!this.aiProvider.available()) {
      return this.humanFlag(violation, 'ANTHROPIC_API_KEY not set — cannot generate object label');
    }

    const node = violation.nodes[0];
    if (!node) return this.humanFlag(violation, 'No node data');

    if (!node.sourceFile || !node.sourceLine) {
      return this.humanFlag(violation, 'No source location to apply an aria-label');
    }

    const source = await readSourceLine(node.sourceFile, node.sourceLine);
    const markup = source?.line ?? node.html;
    const context = source?.context
      ? `Object embed: ${source.line}\nSurrounding code:\n${source.context}`
      : `Object embed: ${node.html}`;

    let name: string;
    try {
      name = await this.aiProvider.suggestAccessibleName(markup, context);
    } catch (err) {
      return this.humanFlag(violation, `AI provider error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const after = await addAttributeToElement(
      node.sourceFile,
      node.sourceLine,
      /<object(\s|>)/g,
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
      description: `Added AI-generated object aria-label: "${name}"`,
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
