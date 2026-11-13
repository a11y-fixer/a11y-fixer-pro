import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as actionsCore from '@actions/core';

// Shared spies/state, hoisted so the vi.mock factory below can close over them.
const h = vi.hoisted(() => ({
  createPR: vi.fn(async (..._args: unknown[]) => ({ url: 'https://github.com/o/r/pull/42', branch: 'a11y-fixer/x', number: 42 })),
  scan: vi.fn(),
  scanOpts: vi.fn(),
  applyAll: vi.fn(),
  prCtor: vi.fn(),
  puppeteerCtor: vi.fn(),
  cacheCtor: vi.fn(),
  cacheSave: vi.fn(async () => {}),
  scanWithCookies: vi.fn(),
}));

vi.mock('@actions/github', () => ({
  context: { repo: { owner: 'o', repo: 'r' } },
}));

// vitest >=3 forbids vi.spyOn on live ESM namespace exports (they are
// non-configurable). `{ spy: true }` auto-wraps every @actions/core export in a
// spy while keeping its real implementation, so getInput still reads INPUT_*
// env vars and we can assert on setOutput/info/warning/setFailed via vi.mocked.
vi.mock('@actions/core', { spy: true });

vi.mock('./cookies-scanner.js', () => ({
  scanWithCookies: (...args: unknown[]) => h.scanWithCookies(...args),
}));

vi.mock('@a11y-fixer/ai', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AnthropicProvider: class { constructor(..._args: any[]) {} },
  CachingProvider: class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      h.cacheCtor(...args);
    }
    available() {
      return false;
    }
    save() {
      return h.cacheSave();
    }
  },
  buildFullRegistry: () => ({ register() {}, applyAll: () => h.applyAll() }),
}));

vi.mock('@a11y-fixer/core', () => {
  class EslintRunner {
    scan() {
      return h.scan();
    }
  }
  class FixerRegistry {
    register() {}
    applyAll() {
      return h.applyAll();
    }
  }
  class PullRequestBuilder {
    constructor(opts: unknown) {
      h.prCtor(opts);
    }
    createPR(...args: unknown[]) {
      return h.createPR(...args);
    }
  }
  const noop = class {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(..._args: any[]) {}
  };
  class PuppeteerRunner {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      h.puppeteerCtor(...args);
    }
    close() {}
  }
  return {
    EslintRunner,
    FixerRegistry,
    PullRequestBuilder,
    AxeDetector: noop,
    PuppeteerRunner,
    ReactJSXMapper: noop,
    // The action delegates scanning to core's scanSource; route it to the spy
    // and record the options so URL/HTML routing can be asserted.
    scanSource: (_dir: string, opts: unknown) => {
      h.scanOpts(opts);
      return h.scan();
    },
    // Real behavior: repo-absolute files of applied fixes, de-duplicated.
    dedupeFixFiles: (fixes: Array<{ applied?: boolean; sourceLocation?: { file: string } }>) => {
      const set = new Set<string>();
      for (const f of fixes) {
        if (f.applied && f.sourceLocation) set.add(f.sourceLocation.file);
      }
      return [...set];
    },
  };
});

const APPLIED_FIX = {
  wcagId: '3.1.1',
  description: 'Add lang attribute',
  applied: true,
  sourceLocation: { file: '/repo/src/App.tsx', line: 1, column: 1 },
};

/** Sets the action's inputs via the INPUT_* env vars @actions/core reads. */
function setInputs(inputs: Record<string, string>): void {
  for (const [name, value] of Object.entries(inputs)) {
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;
  }
}

const savedEnv = { ...process.env };

// A real token signed by the production key (sub=test@example.com, exp ~2126).
// Every mode requires a valid license, so supply one by default; the license
// tests override it.
const VALID_LICENSE =
  'eyJ2IjoxLCJzdWIiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiZXhwIjo0OTQ2NTkxMDQ3fQ.PUo1x635LMj2Hyg5piVzY-U83FTutaRKoPF-8ioK599Oi_0QXlx8MF28dB2dY3sZE9Yl_maZ1HJObSwaSTFDBQ';

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('INPUT_')) delete process.env[k];
  }
  process.env['INPUT_LICENSE-KEY'] = VALID_LICENSE;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('github-action fix mode', () => {
  it('opens a PR when a fix is applied and a token is present', async () => {
    h.scan.mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce([{}]); // before: 2, after: 1
    h.applyAll.mockResolvedValue([APPLIED_FIX]);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok', 'base-branch': 'develop' });

    const { run } = await import('./index.js');
    await run();

    expect(h.createPR).toHaveBeenCalledTimes(1);
    const [fixes, before, after, changedFiles] = h.createPR.mock.calls[0];
    expect(fixes).toEqual([APPLIED_FIX]);
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(1);
    expect(changedFiles).toEqual(['/repo/src/App.tsx']);
    expect(h.prCtor).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'o', repo: 'r', baseBranch: 'develop' }),
    );
  });

  it('wires the PR url to the pr-url output and logs the PR lifecycle', async () => {
    h.scan.mockResolvedValueOnce([{}, {}]).mockResolvedValueOnce([{}]);
    h.applyAll.mockResolvedValue([APPLIED_FIX]);
    const setOutput = vi.mocked(actionsCore.setOutput);
    const info = vi.mocked(actionsCore.info);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok', 'base-branch': 'develop' });

    const { run } = await import('./index.js');
    await run();

    expect(setOutput).toHaveBeenCalledWith('pr-url', 'https://github.com/o/r/pull/42');
    expect(info).toHaveBeenCalledWith('Opening PR against o/r@develop...');
    expect(info).toHaveBeenCalledWith('PR created: https://github.com/o/r/pull/42');
  });

  it('passes the current working directory as repoRoot to PullRequestBuilder', async () => {
    h.scan.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]);
    h.applyAll.mockResolvedValue([APPLIED_FIX]);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok', 'base-branch': 'develop' });

    const { run } = await import('./index.js');
    await run();

    expect(h.prCtor).toHaveBeenCalledWith(
      expect.objectContaining({ repoRoot: process.cwd() }),
    );
  });

  it('defaults the PR base branch to main when base-branch is unset', async () => {
    h.scan.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]);
    h.applyAll.mockResolvedValue([APPLIED_FIX]);
    const info = vi.mocked(actionsCore.info);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(h.prCtor).toHaveBeenCalledWith(
      expect.objectContaining({ baseBranch: 'main' }),
    );
    expect(info).toHaveBeenCalledWith('Opening PR against o/r@main...');
  });

  it('fails the run (and sets no pr-url) when createPR rejects', async () => {
    h.scan.mockResolvedValueOnce([{}]).mockResolvedValueOnce([{}]);
    h.applyAll.mockResolvedValue([APPLIED_FIX]);
    h.createPR.mockRejectedValueOnce(new Error('boom'));
    const setFailed = vi.mocked(actionsCore.setFailed);
    const setOutput = vi.mocked(actionsCore.setOutput);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await expect(run()).resolves.toBeUndefined();

    expect(setFailed).toHaveBeenCalledWith('boom');
    expect(setOutput).not.toHaveBeenCalledWith('pr-url', expect.anything());
  });

  it('does not open a PR when nothing was applied', async () => {
    h.scan.mockResolvedValue([{}]);
    h.applyAll.mockResolvedValue([{ wcagId: '1.1.1', description: 'x', applied: false, humanNote: 'review' }]);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(h.createPR).not.toHaveBeenCalled();
  });

  it('does not open a PR when no github-token is provided', async () => {
    h.scan.mockResolvedValue([{}]);
    h.applyAll.mockResolvedValue([APPLIED_FIX]);
    setInputs({ mode: 'fix', dir: '.' });

    const { run } = await import('./index.js');
    await run();

    expect(h.createPR).not.toHaveBeenCalled();
  });

  it('does not open a PR when applied fixes touched no files', async () => {
    h.scan.mockResolvedValue([{}]);
    // Applied, but with no sourceLocation → dedupeFixFiles yields [].
    h.applyAll.mockResolvedValue([{ wcagId: '4.1.2', description: 'x', applied: true }]);
    const info = vi.mocked(actionsCore.info);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(h.createPR).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('No files were changed — skipping PR.');
  });

  it('wraps the provider in a cache (threading cache-file) and flushes it after applying', async () => {
    h.scan.mockResolvedValue([]);
    h.applyAll.mockResolvedValue([]);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok', 'cache-file': '/tmp/ai-cache.json' });

    const { run } = await import('./index.js');
    await run();

    expect(h.cacheCtor).toHaveBeenCalledWith(expect.anything(), { cacheFile: '/tmp/ai-cache.json' });
    expect(h.cacheSave).toHaveBeenCalledTimes(1);
  });

  it('passes an undefined cache-file through when none is set', async () => {
    h.scan.mockResolvedValue([]);
    h.applyAll.mockResolvedValue([]);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(h.cacheCtor).toHaveBeenCalledWith(expect.anything(), { cacheFile: undefined });
  });

  it('warns and ignores url in fix mode (static-only)', async () => {
    h.scan.mockResolvedValue([]);
    h.applyAll.mockResolvedValue([]);
    const warning = vi.mocked(actionsCore.warning);
    setInputs({ mode: 'fix', dir: '.', url: 'https://example.com', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('URL fix-mode is not supported'));
    // No browser runner is constructed, and scanning uses the static path.
    expect(h.puppeteerCtor).not.toHaveBeenCalled();
    expect(h.scanOpts).toHaveBeenCalledWith({ html: false });
  });
});

describe('github-action check mode', () => {
  it('fails the run and lists violations when any are found', async () => {
    h.scan.mockResolvedValue([{ wcagId: '1.1.1', description: 'Image missing alt' }]);
    const setFailed = vi.mocked(actionsCore.setFailed);
    setInputs({ mode: 'check', dir: '.' });

    const { run } = await import('./index.js');
    await run();

    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('1 accessibility violation'));
    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('WCAG 1.1.1'));
  });

  it('passes when no violations are found', async () => {
    h.scan.mockResolvedValue([]);
    const setFailed = vi.mocked(actionsCore.setFailed);
    const info = vi.mocked(actionsCore.info);
    setInputs({ mode: 'check', dir: '.' });

    const { run } = await import('./index.js');
    await run();

    expect(setFailed).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No accessibility violations'));
  });
});

describe('github-action scan mode', () => {
  it('outputs the violations JSON', async () => {
    const violations = [{ wcagId: '1.4.3', description: 'contrast' }];
    h.scan.mockResolvedValue(violations);
    const setOutput = vi.mocked(actionsCore.setOutput);
    setInputs({ mode: 'scan', dir: '.' });

    const { run } = await import('./index.js');
    await run();

    expect(setOutput).toHaveBeenCalledWith('violations', JSON.stringify(violations));
  });

  it('passes the url through to the scanner in scan mode', async () => {
    h.scan.mockResolvedValue([]);
    setInputs({ mode: 'scan', dir: '.', url: 'https://example.com' });

    const { run } = await import('./index.js');
    await run();

    expect(h.scanOpts).toHaveBeenCalledWith({ url: 'https://example.com', html: false });
  });
});

describe('github-action cookies support', () => {
  const COOKIES = [{ name: 'session', value: 'abc123', domain: 'example.com' }];

  it('routes to cookies-scanner in scan mode when both url and cookies are set', async () => {
    h.scanWithCookies.mockResolvedValue([]);
    setInputs({ mode: 'scan', dir: '.', url: 'https://example.com', cookies: JSON.stringify(COOKIES) });

    const { run } = await import('./index.js');
    await run();

    expect(h.scanWithCookies).toHaveBeenCalledWith(expect.any(String), { url: 'https://example.com', cookies: COOKIES });
    expect(h.scanOpts).not.toHaveBeenCalled();
  });

  it('routes to cookies-scanner in check mode when both url and cookies are set', async () => {
    h.scanWithCookies.mockResolvedValue([]);
    setInputs({ mode: 'check', dir: '.', url: 'https://example.com', cookies: JSON.stringify(COOKIES) });

    const { run } = await import('./index.js');
    await run();

    expect(h.scanWithCookies).toHaveBeenCalledWith(expect.any(String), { url: 'https://example.com', cookies: COOKIES });
    expect(h.scanOpts).not.toHaveBeenCalled();
  });

  it('fails early with a clear message when cookies JSON is invalid', async () => {
    const setFailed = vi.mocked(actionsCore.setFailed);
    setInputs({ mode: 'scan', dir: '.', url: 'https://example.com', cookies: 'not-json' });

    const { run } = await import('./index.js');
    await run();

    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('Invalid `cookies` input'));
    expect(h.scanWithCookies).not.toHaveBeenCalled();
  });

  it('warns and ignores cookies in fix mode', async () => {
    h.scan.mockResolvedValue([]);
    h.applyAll.mockResolvedValue([]);
    const warning = vi.mocked(actionsCore.warning);
    setInputs({ mode: 'fix', dir: '.', url: 'https://example.com', cookies: JSON.stringify(COOKIES), 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('URL fix-mode is not supported'));
    expect(h.scanWithCookies).not.toHaveBeenCalled();
    expect(h.scanOpts).toHaveBeenCalledWith({ html: false });
  });

  it('warns when cookies is set without url', async () => {
    h.scan.mockResolvedValue([]);
    const warning = vi.mocked(actionsCore.warning);
    setInputs({ mode: 'scan', dir: '.', cookies: JSON.stringify(COOKIES) });

    const { run } = await import('./index.js');
    await run();

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('`cookies` is set but `url` is not'));
    expect(h.scanWithCookies).not.toHaveBeenCalled();
  });
});

describe('github-action error handling', () => {
  it('calls setFailed with the error message when a scan throws', async () => {
    h.scan.mockRejectedValue(new Error('scan exploded'));
    const setFailed = vi.mocked(actionsCore.setFailed);
    setInputs({ mode: 'check', dir: '.' });

    const { run } = await import('./index.js');
    await run();

    expect(setFailed).toHaveBeenCalledWith('scan exploded');
  });
});

describe('github-action license gating', () => {
  it('fails and does nothing when no license key is provided', async () => {
    delete process.env['INPUT_LICENSE-KEY'];
    const setFailed = vi.mocked(actionsCore.setFailed);
    setInputs({ mode: 'check', dir: '.' });

    const { run } = await import('./index.js');
    await run();

    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('valid license key'));
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('fails when the license key is invalid', async () => {
    process.env['INPUT_LICENSE-KEY'] = 'garbage.token';
    const setFailed = vi.mocked(actionsCore.setFailed);
    setInputs({ mode: 'fix', dir: '.', 'github-token': 'tok' });

    const { run } = await import('./index.js');
    await run();

    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining('license key'));
    expect(h.applyAll).not.toHaveBeenCalled();
    expect(h.createPR).not.toHaveBeenCalled();
  });
});
