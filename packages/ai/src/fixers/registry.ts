import { FixerRegistry, registerCoreFixers } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { AltTextFixer, type ScreenshotProvider } from './alt-text.js';
import { LinkTextFixer } from './link-text.js';
import { ButtonNameFixer } from './button-name.js';
import { FormLabelFixer } from './form-label.js';

/**
 * Builds the full fixer registry used by the paid GitHub Action: the
 * AI-assisted fixers plus every deterministic fixer from `@a11y-fixer/core`.
 *
 * The AI-assisted fixers are registered *first* so that, with canFix-based
 * dispatch, they claim the axe rules (button-name, label, …) that share a WCAG
 * id with an ESLint rule before the generic EslintFixer registered by
 * {@link registerCoreFixers}.
 */
export function buildFullRegistry(
  aiProvider: AIProvider,
  rootDir: string,
  screenshots?: ScreenshotProvider,
): FixerRegistry {
  const registry = new FixerRegistry();

  registry.register(new AltTextFixer(aiProvider, rootDir, screenshots));
  registry.register(new LinkTextFixer(aiProvider, rootDir));
  registry.register(new ButtonNameFixer(aiProvider, rootDir));
  registry.register(new FormLabelFixer(aiProvider, rootDir));

  registerCoreFixers(registry, rootDir);

  return registry;
}
