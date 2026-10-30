import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { AIProvider } from './index.js';

export interface CachingProviderOptions {
  /**
   * Path to a JSON file used as a persistent cross-run cache. When set, the
   * file is loaded on construction and written back on {@link CachingProvider.save}.
   * When omitted, only the in-memory (per-run) cache is used.
   */
  cacheFile?: string;
}

/**
 * Wraps an {@link AIProvider} with a memoizing cache so identical requests cost
 * at most one API call.
 *
 * Two layers:
 * 1. In-memory promise memoization (always on). The *promise* is cached, so
 *    concurrent identical calls coalesce into a single delegate request.
 * 2. Optional persistent disk cache (when `cacheFile` is set), giving cross-run
 *    savings when paired with a CI cache (e.g. actions/cache).
 *
 * Only successful string results are cached — a thrown error is never memoized,
 * so a transient API failure does not become permanent. `available()` is a
 * pass-through and is never cached.
 */
export class CachingProvider implements AIProvider {
  /** In-flight / resolved promises, keyed by request hash (per-run dedup). */
  private readonly inflight = new Map<string, Promise<string>>();
  /** Resolved values persisted to / loaded from disk. */
  private readonly disk = new Map<string, string>();
  private loaded = false;

  constructor(
    private readonly delegate: AIProvider,
    private readonly options: CachingProviderOptions = {},
  ) {}

  available(): boolean {
    return this.delegate.available();
  }

  describeImage(imageBuffer: Buffer, context: string): Promise<string> {
    const key = this.keyFor('describeImage', imageBuffer, context);
    return this.memoize(key, () => this.delegate.describeImage(imageBuffer, context));
  }

  suggestAltText(context: string): Promise<string> {
    const key = this.keyFor('suggestAltText', context);
    return this.memoize(key, () => this.delegate.suggestAltText(context));
  }

  rewriteLinkText(current: string, context: string): Promise<string> {
    const key = this.keyFor('rewriteLinkText', current, context);
    return this.memoize(key, () => this.delegate.rewriteLinkText(current, context));
  }

  suggestAccessibleName(element: string, context: string): Promise<string> {
    const key = this.keyFor('suggestAccessibleName', element, context);
    return this.memoize(key, () => this.delegate.suggestAccessibleName(element, context));
  }

  /**
   * Flushes the in-memory cache to the configured `cacheFile` (no-op when no
   * file is configured). Failures are logged and swallowed — persistence is an
   * optimization and must never fail a run.
   */
  async save(): Promise<void> {
    if (!this.options.cacheFile) return;
    try {
      const obj: Record<string, string> = {};
      for (const [k, v] of this.disk) obj[k] = v;
      await writeFile(this.options.cacheFile, JSON.stringify(obj), 'utf8');
    } catch (err) {
      console.warn(`a11y-fixer: could not write AI cache file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Lazily loads the disk cache the first time it is needed. */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.options.cacheFile) return;
    try {
      const raw = await readFile(this.options.cacheFile, 'utf8');
      const obj = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') this.disk.set(k, v);
      }
    } catch {
      // Missing or corrupt cache file: start cold, don't fail the run.
    }
  }

  private memoize(key: string, call: () => Promise<string>): Promise<string> {
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      await this.ensureLoaded();
      const cached = this.disk.get(key);
      if (cached !== undefined) return cached;

      const value = await call();
      this.disk.set(key, value);
      return value;
    })();

    // Cache the promise for dedup, but drop it on failure so errors aren't
    // memoized and a later call can retry.
    this.inflight.set(key, promise);
    promise.catch(() => this.inflight.delete(key));
    return promise;
  }

  private keyFor(method: string, ...args: (string | Buffer)[]): string {
    const hash = createHash('sha256');
    hash.update(method);
    for (const arg of args) {
      hash.update('\0');
      hash.update(arg);
    }
    return hash.digest('hex');
  }
}
