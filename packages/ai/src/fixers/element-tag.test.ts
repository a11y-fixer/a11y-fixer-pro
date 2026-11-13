import { describe, it, expect } from 'vitest';
import { openingTagRegex } from './element-tag.js';

describe('openingTagRegex', () => {
  it('derives a regex for a standard tag', () => {
    const re = openingTagRegex('<div role="button">Go</div>');
    expect(re).not.toBeNull();
    expect('<div role="button">'.match(re!)).not.toBeNull();
  });

  it('matches the self-closing / attribute-adjacent form', () => {
    const re = openingTagRegex('<a role="menuitem" href="#">');
    expect('<a href="#">'.match(re!)).not.toBeNull();
  });

  it('works for custom/namespaced-ish tag names', () => {
    const re = openingTagRegex('<my-widget role="switch"></my-widget>');
    expect(re).not.toBeNull();
    expect('<my-widget role="switch">'.match(re!)).not.toBeNull();
  });

  it('does not match a different tag', () => {
    const re = openingTagRegex('<button role="button">');
    expect('<div>'.match(re!)).toBeNull();
  });

  it('returns null when there is no opening tag', () => {
    expect(openingTagRegex('App.tsx:12:3')).toBeNull();
    expect(openingTagRegex('')).toBeNull();
    expect(openingTagRegex('just text')).toBeNull();
  });
});
