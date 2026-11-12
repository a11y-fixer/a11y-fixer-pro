import { FixerRegistry, registerCoreFixers } from '@a11y-fixer/core';
import type { AIProvider } from '../provider/index.js';
import { AltTextFixer, type ScreenshotProvider } from './alt-text.js';
import { LinkTextFixer } from './link-text.js';
import { LinkNameFixer } from './link-name.js';
import { ButtonNameFixer } from './button-name.js';
import { FormLabelFixer } from './form-label.js';
import { SelectNameFixer } from './select-name.js';
import { InputButtonNameFixer } from './input-button-name.js';
import { InputImageAltFixer } from './input-image-alt.js';

/**
 * Builds the full fixer registry used by the paid GitHub Action: the
 * AI-assisted fixers plus every deterministic fixer from `@a11y-fixer/core`.
 *
 * The AI-assisted fixers are registered *first* so that, with canFix-based
 * dispatch, they claim the axe rules (button-name, label, …) that share a WCAG
 * id with an ESLint rule before the generic EslintFixer registered by
 * {@link registerCoreFixers}.
 *
 * Ordering within the AI fixers matters too: id-keyed fixers must precede the
 * wcagId-keyed {@link LinkTextFixer}. `getFixer` returns the first `canFix`
 * match, and core maps axe's `link-name` rule to WCAG 2.4.4 — the same id
 * LinkTextFixer claims. So LinkNameFixer (specific: `id === 'link-name'`) is
 * registered before LinkTextFixer (broad: `wcagId === '2.4.4'`); otherwise
 * LinkTextFixer swallows every icon/empty-link violation and LinkNameFixer
 * never runs. JSX empty anchors (`id = jsx-a11y/anchor-has-content`, 2.4.4) do
 * not match LinkNameFixer's id, so they still route to LinkTextFixer.
 *
 * For the same reason {@link InputImageAltFixer} (specific: `id ===
 * 'input-image-alt'`) is registered before {@link AltTextFixer} (broad: `wcagId
 * === '1.1.1'`). Core leaves `input-image-alt` out of AXE_WCAG_MAP today, so its
 * wcagId is the raw id and AltTextFixer would not claim it — but if core ever
 * maps `input-image-alt → 1.1.1`, this ordering keeps the `<input>`-aware fixer
 * ahead of the `<img>`-only AltTextFixer. SelectNameFixer and
 * InputButtonNameFixer key on unique axe ids with no such overlap.
 */
export function buildFullRegistry(
  aiProvider: AIProvider,
  rootDir: string,
  screenshots?: ScreenshotProvider,
): FixerRegistry {
  const registry = new FixerRegistry();

  registry.register(new InputImageAltFixer(aiProvider, rootDir));
  registry.register(new AltTextFixer(aiProvider, rootDir, screenshots));
  registry.register(new LinkNameFixer(aiProvider, rootDir));
  registry.register(new LinkTextFixer(aiProvider, rootDir));
  registry.register(new ButtonNameFixer(aiProvider, rootDir));
  registry.register(new FormLabelFixer(aiProvider, rootDir));
  registry.register(new SelectNameFixer(aiProvider, rootDir));
  registry.register(new InputButtonNameFixer(aiProvider, rootDir));

  registerCoreFixers(registry, rootDir);

  return registry;
}
