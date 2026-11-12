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
export { SelectNameFixer } from './fixers/select-name.js';
export { InputButtonNameFixer } from './fixers/input-button-name.js';
export { InputImageAltFixer } from './fixers/input-image-alt.js';
export { AreaAltFixer } from './fixers/area-alt.js';
export { ObjectAltFixer } from './fixers/object-alt.js';
export { SvgImgAltFixer } from './fixers/svg-img-alt.js';
export { AriaCommandNameFixer } from './fixers/aria-command-name.js';
export { AriaInputFieldNameFixer } from './fixers/aria-input-field-name.js';
export { AriaToggleFieldNameFixer } from './fixers/aria-toggle-field-name.js';

export { buildFullRegistry } from './fixers/registry.js';
