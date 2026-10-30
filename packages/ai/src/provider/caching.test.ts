import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CachingProvider } from './caching.js';
import type { AIProvider } from './index.js';

/** A stub provider that counts calls and echoes its arguments. */
class CountingProvider implements AIProvider {
  calls = { describeImage: 0, suggestAltText: 0, rewriteLinkText: 0, suggestAccessibleName: 0 };
  avail = true;

  available(): boolean {
    return this.avail;
  }
  async describeImage(_buf: Buffer, context: string): Promise<string> {
    this.calls.describeImage++;
    return `image:${context}`;
  }
  async suggestAltText(context: string): Promise<string> {
    this.calls.suggestAltText++;
    return `alt:${context}`;
  }
  async rewriteLinkText(current: string, context: string): Promise<string> {
    this.calls.rewriteLinkText++;
    return `link:${current}:${context}`;
  }
  async suggestAccessibleName(element: string, context: string): Promise<string> {
    this.calls.suggestAccessibleName++;
    return `name:${element}:${context}`;
  }
}

describe('CachingProvider', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'a11y-cache-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('available() delegates', () => {
    const inner = new CountingProvider();
    const cache = new CachingProvider(inner);
    expect(cache.available()).toBe(true);
    inner.avail = false;
    expect(cache.available()).toBe(false);
  });

  it('returns the cached value on a repeat call without hitting the delegate', async () => {
    const inner = new CountingProvider();
    const cache = new CachingProvider(inner);

    expect(await cache.suggestAltText('header')).toBe('alt:header');
    expect(await cache.suggestAltText('header')).toBe('alt:header');

    expect(inner.calls.suggestAltText).toBe(1);
  });

  it('distinct arguments produce distinct delegate calls', async () => {
    const inner = new CountingProvider();
    const cache = new CachingProvider(inner);

    await cache.rewriteLinkText('click here', 'pricing');
    await cache.rewriteLinkText('click here', 'docs');
    await cache.rewriteLinkText('read more', 'pricing');

    expect(inner.calls.rewriteLinkText).toBe(3);
  });

  it('coalesces concurrent identical calls into one delegate request', async () => {
    const inner = new CountingProvider();
    const cache = new CachingProvider(inner);

    const [a, b] = await Promise.all([
      cache.suggestAccessibleName('<button>', 'modal'),
      cache.suggestAccessibleName('<button>', 'modal'),
    ]);

    expect(a).toBe('name:<button>:modal');
    expect(b).toBe(a);
    expect(inner.calls.suggestAccessibleName).toBe(1);
  });

  it('keys describeImage on both the buffer bytes and the context', async () => {
    const inner = new CountingProvider();
    const cache = new CachingProvider(inner);

    await cache.describeImage(Buffer.from('AAAA'), 'ctx');
    await cache.describeImage(Buffer.from('AAAA'), 'ctx'); // hit
    await cache.describeImage(Buffer.from('BBBB'), 'ctx'); // different bytes
    await cache.describeImage(Buffer.from('AAAA'), 'other'); // different context

    expect(inner.calls.describeImage).toBe(3);
  });

  it('does not cache errors — a later call retries', async () => {
    const inner = new CountingProvider();
    const spy = vi
      .spyOn(inner, 'suggestAltText')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('alt:ok');
    const cache = new CachingProvider(inner);

    await expect(cache.suggestAltText('x')).rejects.toThrow('boom');
    expect(await cache.suggestAltText('x')).toBe('alt:ok');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('persists to disk and reloads across instances', async () => {
    const cacheFile = path.join(tmp, 'cache.json');

    const inner1 = new CountingProvider();
    const cache1 = new CachingProvider(inner1, { cacheFile });
    expect(await cache1.suggestAltText('logo')).toBe('alt:logo');
    await cache1.save();
    expect(inner1.calls.suggestAltText).toBe(1);

    const inner2 = new CountingProvider();
    const cache2 = new CachingProvider(inner2, { cacheFile });
    expect(await cache2.suggestAltText('logo')).toBe('alt:logo');
    expect(inner2.calls.suggestAltText).toBe(0); // served from disk

    const onDisk = JSON.parse(await readFile(cacheFile, 'utf8'));
    expect(Object.values(onDisk)).toContain('alt:logo');
  });

  it('starts cold when the cache file is missing or corrupt', async () => {
    const cacheFile = path.join(tmp, 'corrupt.json');
    await writeFile(cacheFile, 'not json', 'utf8');

    const inner = new CountingProvider();
    const cache = new CachingProvider(inner, { cacheFile });

    expect(await cache.suggestAltText('x')).toBe('alt:x');
    expect(inner.calls.suggestAltText).toBe(1);
  });

  it('save() is a no-op without a cache file', async () => {
    const cache = new CachingProvider(new CountingProvider());
    await expect(cache.save()).resolves.toBeUndefined();
  });

  it('save() swallows write failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A directory path can't be written as a file.
    const cache = new CachingProvider(new CountingProvider(), { cacheFile: tmp });
    await cache.suggestAltText('x');
    await expect(cache.save()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
