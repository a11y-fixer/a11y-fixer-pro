export type { AIProvider } from './provider/index.js';
export { AnthropicProvider } from './provider/anthropic.js';
export { CachingProvider } from './provider/caching.js';
export type { CachingProviderOptions } from './provider/caching.js';

export { AltTextFixer } from './fixers/alt-text.js';
export type { ScreenshotProvider } from './fixers/alt-text.js';
export { LinkTextFixer } from './fixers/link-text.js';
export { LinkNameFixer } from './fixers/link-name.js';
export { ButtonNameFixer } from './fixers/button-name.js';
export { FormLabelFixer } from './fixers/form-label.js';

export { buildFullRegistry } from './fixers/registry.js';
