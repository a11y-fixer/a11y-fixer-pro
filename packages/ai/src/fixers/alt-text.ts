import type { Fixer, FixResult } from '@a11y-fixer/core';
import type { A11yViolation, A11yNode } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { readSourceLine } from './source-line.js';
import { addAttributeToElement } from '@a11y-fixer/core';

/** Supplies a screenshot buffer for an element, enabling vision-based alt text. */
export interface ScreenshotProvider {
  screenshotElement(target: string[]): Promise<Buffer | null>;
}

export class AltTextFixer implements Fixer {
  readonly wcagId = '1.1.1';
  readonly bucket = 'ai-assisted' as const;

  constructor(
    private readonly aiProvider: AIProvider,
    private readonly rootDir: string,
    private readonly screenshots?: ScreenshotProvider,
  ) {}

  canFix(violation: A11yViolation): boolean {
    // Responsibility only — fix() reports the missing-API-key case so the user
    // gets a precise hint rather than a generic "no fixer registered".
    return violation.wcagId === '1.1.1';
  }

  async fix(violation: A11yViolation): Promise<FixResult> {
    if (!this.aiProvider.available()) {
      return this.humanFlag(violation, 'ANTHROPIC_API_KEY not set — cannot generate alt text');
    }

    const node = violation.nodes[0];
    if (!node) return this.humanFlag(violation, 'No node data');

    // On the ESLint path node.html is "file:line:col", so read the real source
    // line for the <img> markup and src.
    const source = node.sourceFile && node.sourceLine
      ? await readSourceLine(node.sourceFile, node.sourceLine)
      : null;
    const markup = source?.line ?? node.html;
    const srcMatch = markup.match(/src=["']([^"']+)["']/);
    const imageSrc = srcMatch?.[1] ?? '';
    const context = source?.context
      ? `Image element: ${source.line}\nSurrounding code:\n${source.context}`
      : `Image element: ${node.html}`;

    let altText: string;
    try {
      altText = await this.generateAltText(node, imageSrc, context);
    } catch (err) {
      return this.humanFlag(violation, `AI provider error: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (node.sourceFile && node.sourceLine) {
      const before = markup;
      const after = await this.applyAltToSource(node.sourceFile, node.sourceLine, altText);
      return {
        wcagId: this.wcagId,
        bucket: 'ai-assisted',
        applied: after !== null,
        description: `Added AI-generated alt text: "${altText}"`,
        before,
        after: after ?? undefined,
        sourceLocation: { file: node.sourceFile, line: node.sourceLine, column: node.sourceColumn ?? 1 },
      };
    }

    return this.humanFlag(violation, `Suggested alt text: "${altText}" — no source location to apply`);
  }

  /** Vision when a screenshot is available, otherwise a context-only description. */
  private async generateAltText(node: A11yNode, imageSrc: string, context: string): Promise<string> {
    if (this.screenshots) {
      const buffer = await this.screenshots.screenshotElement(node.target);
      if (buffer && buffer.length > 0) {
        return this.aiProvider.describeImage(buffer, context);
      }
    }
    return this.aiProvider.suggestAltText(
      imageSrc ? `${context}\nImage src: ${imageSrc}` : context,
    );
  }

  private async applyAltToSource(file: string, line: number, altText: string): Promise<string | null> {
    // Add an alt attribute to the <img> tag; returns null if it already has one
    // or the pattern didn't match.
    return addAttributeToElement(file, line, /<img(\s)/g, 'alt', altText);
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
