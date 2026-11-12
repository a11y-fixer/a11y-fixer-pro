import { describe, it, expect, vi } from 'vitest';
import type { A11yViolation } from '@a11y-fixer/core';
import { EslintFixer, HtmlLangFixer } from '@a11y-fixer/core';
import { buildFullRegistry } from './registry.js';
import { AltTextFixer } from './alt-text.js';
import { LinkNameFixer } from './link-name.js';
import { ButtonNameFixer } from './button-name.js';
import { FormLabelFixer } from './form-label.js';
import { SelectNameFixer } from './select-name.js';
import { InputButtonNameFixer } from './input-button-name.js';
import { InputImageAltFixer } from './input-image-alt.js';
import type { AIProvider } from '../provider/index.js';

const provider: AIProvider = {
  available: () => true,
  describeImage: vi.fn(),
  suggestAltText: vi.fn(),
  rewriteLinkText: vi.fn(),
  suggestAccessibleName: vi.fn(),
};

function violation(id: string, wcagId: string): A11yViolation {
  return {
    id,
    wcagId,
    impact: 'serious',
    description: '',
    helpUrl: '',
    nodes: [{ html: '', target: [], failureSummary: '' }],
  };
}

describe('buildFullRegistry dispatch', () => {
  const registry = buildFullRegistry(provider, '/tmp');

  it('routes axe image-alt (WCAG 1.1.1) to AltTextFixer', () => {
    expect(registry.getFixer(violation('image-alt', '1.1.1'))).toBeInstanceOf(AltTextFixer);
  });

  it('routes axe button-name (WCAG 4.1.2) to ButtonNameFixer, not EslintFixer', () => {
    expect(registry.getFixer(violation('button-name', '4.1.2'))).toBeInstanceOf(ButtonNameFixer);
  });

  it('routes axe link-name (WCAG 4.1.2) to LinkNameFixer, not EslintFixer', () => {
    expect(registry.getFixer(violation('link-name', '4.1.2'))).toBeInstanceOf(LinkNameFixer);
  });

  it('routes axe label (WCAG 1.3.1) to FormLabelFixer, not EslintFixer', () => {
    expect(registry.getFixer(violation('label', '1.3.1'))).toBeInstanceOf(FormLabelFixer);
  });

  it('routes axe select-name to SelectNameFixer', () => {
    expect(registry.getFixer(violation('select-name', 'select-name'))).toBeInstanceOf(SelectNameFixer);
  });

  it('routes axe input-button-name to InputButtonNameFixer', () => {
    expect(registry.getFixer(violation('input-button-name', 'input-button-name'))).toBeInstanceOf(InputButtonNameFixer);
  });

  it('routes axe input-image-alt to InputImageAltFixer, not AltTextFixer', () => {
    // Unmapped in core, so wcagId is the raw id; even if core later maps it to
    // 1.1.1, InputImageAltFixer is registered first and still wins.
    expect(registry.getFixer(violation('input-image-alt', 'input-image-alt'))).toBeInstanceOf(InputImageAltFixer);
    expect(registry.getFixer(violation('input-image-alt', '1.1.1'))).toBeInstanceOf(InputImageAltFixer);
  });

  it('still routes deterministic axe html-has-lang (WCAG 3.1.1) to HtmlLangFixer', () => {
    expect(registry.getFixer(violation('html-has-lang', '3.1.1'))).toBeInstanceOf(HtmlLangFixer);
  });

  it('still routes ESLint-sourced violations to EslintFixer', () => {
    expect(registry.getFixer(violation('jsx-a11y/heading-has-content', '2.4.6'))).toBeInstanceOf(EslintFixer);
  });
});
