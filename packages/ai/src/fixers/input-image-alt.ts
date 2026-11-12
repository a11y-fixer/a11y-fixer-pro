import type { Fixer, FixResult } from '@a11y-fixer/core';
import type { A11yViolation } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { readSourceLine } from './source-line.js';
import { addAttributeToElement } from '@a11y-fixer/core';

/**
 * Fixes `<input type="image">` controls with no text alternative (axe
 * `input-image-alt`, WCAG 1.1.1) by adding an AI-generated `alt` attribute.
 * Alt text comes from code context only (`suggestAltText`): this fixer runs on
 * the static source, where no rendered pixels are available.
 *
 * This is kept separate from {@link AltTextFixer} (which targets `<img>` and
 * keys on WCAG 1.1.1) so it can key on the specific axe id and own its own tag
 * regex — see the registry ordering note.
 */
export class InputImageAltFixer implements Fixer {
  readonly wcagId = '1.1.1';
  readonly bucket = 'ai-assisted' as const;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly rootDir: string,
  ) {}

  canFix(violation: A11yViolation): boolean {
    // Key on the axe rule id: core leaves `input-image-alt` out of AXE_WCAG_MAP,
    // so violation.wcagId is the raw id rather than the shared 1.1.1.
    return violation.id === 'input-image-alt';
  }

  async fix(violation: A11yViolation): Promise<FixResult> {
    if (!this.aiProvider.available()) {
      return this.humanFlag(violation, 'ANTHROPIC_API_KEY not set — cannot generate alt text');
    }

    const node = violation.nodes[0];
    if (!node) return this.humanFlag(violation, 'No node data');

    if (!node.sourceFile || !node.sourceLine) {
      return this.humanFlag(violation, 'No source location to apply alt text');
    }

    const source = await readSourceLine(node.sourceFile, node.sourceLine);
    const markup = source?.line ?? node.html;
    const srcMatch = markup.match(/src=["']([^"']+)["']/);
    const imageSrc = srcMatch?.[1] ?? '';
    const context = source?.context
      ? `Image button: ${source.line}\nSurrounding code:\n${source.context}`
      : `Image button: ${node.html}`;

    let altText: string;
    try {
      altText = await this.aiProvider.suggestAltText(
        imageSrc ? `${context}\nImage src: ${imageSrc}` : context,
      );
    } catch (err) {
      return this.humanFlag(violation, `AI provider error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const after = await addAttributeToElement(
      node.sourceFile,
      node.sourceLine,
      /<input(\s)/g,
      'alt',
      altText,
    );

    if (after === null) {
      return this.humanFlag(violation, `Suggested alt text "${altText}" — could not apply to source`);
    }

    return {
      wcagId: this.wcagId,
      bucket: 'ai-assisted',
      applied: true,
      description: `Added AI-generated image button alt text: "${altText}"`,
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
