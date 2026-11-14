import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CookieParam } from 'puppeteer-core';

// scanWithCookies loads puppeteer-core and @axe-core/puppeteer via dynamic
// import() so they can stay out of the ncc bundle (installed at action
// runtime). We mock those specifiers per-test with vi.doMock + resetModules,
// importing the scanner fresh each time so each test controls the branch taken.

const COOKIES: CookieParam[] = [{ name: 'session', value: 'abc', domain: 'example.com' }];

type MockOpts = {
  violations?: unknown[];
  /** Put launch() at the module root instead of under `default` (covers `?? puppeteerMod`). */
  noDefaultExport?: boolean;
};

function mockDeps({ violations = [], noDefaultExport = false }: MockOpts = {}) {
  const page = {
    setCookie: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
  };
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const launch = vi.fn(async () => browser);

  // When noDefaultExport, keep an explicit `default: undefined` key: vitest's
  // ESM-mock interop throws on reading a *missing* `default`, so this is how we
  // exercise the scanner's `puppeteerMod.default ?? puppeteerMod` fallback.
  vi.doMock('puppeteer-core', () =>
    noDefaultExport ? { default: undefined, launch } : { default: { launch } },
  );
  vi.doMock('@axe-core/puppeteer', () => ({
    default: class {
      constructor(_page: unknown) {}
      async analyze() {
        return { violations };
      }
    },
  }));

  return { launch, browser, page };
}

async function importScanner() {
  const mod = await import('./cookies-scanner.js');
  return mod.scanWithCookies;
}

describe('scanWithCookies', () => {
  beforeEach(() => {
    // Clear any mock registered by a prior test, then reset the module cache so
    // the scanner re-imports fresh against this test's doMock calls.
    vi.doUnmock('puppeteer-core');
    vi.doUnmock('@axe-core/puppeteer');
    vi.resetModules();
    delete process.env['PUPPETEER_EXECUTABLE_PATH'];
  });
  afterEach(() => {
    vi.resetModules();
  });

  it('launches a browser, sets cookies, navigates, and maps violations', async () => {
    const { launch, browser, page } = mockDeps({
      violations: [
        {
          id: 'image-alt',
          impact: 'critical',
          description: 'Image missing alt',
          helpUrl: 'https://help/image-alt',
          nodes: [{ html: '<img>', target: ['img', 0], failureSummary: 'fix it' }],
        },
      ],
    });
    const scanWithCookies = await importScanner();

    const result = await scanWithCookies('.', { url: 'https://app.example.com', cookies: COOKIES });

    expect(launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    expect(page.setCookie).toHaveBeenCalledWith(...COOKIES);
    expect(page.goto).toHaveBeenCalledWith('https://app.example.com', { waitUntil: 'networkidle0' });
    expect(browser.close).toHaveBeenCalled();
    expect(result).toEqual([
      {
        id: 'image-alt',
        wcagId: '1.1.1', // mapped via AXE_WCAG_MAP
        impact: 'critical',
        description: 'Image missing alt',
        helpUrl: 'https://help/image-alt',
        nodes: [{ html: '<img>', target: ['img', '0'], failureSummary: 'fix it' }],
      },
    ]);
  });

  it('defaults impact and failureSummary, and falls back to the raw id for unknown rules', async () => {
    mockDeps({
      violations: [
        {
          id: 'some-unmapped-rule',
          description: 'mystery',
          helpUrl: 'https://help/x',
          nodes: [{ html: '<div>', target: ['div'] }],
        },
      ],
    });
    const scanWithCookies = await importScanner();

    const result = await scanWithCookies('.', { url: 'https://x', cookies: COOKIES });

    expect(result[0]).toMatchObject({
      wcagId: 'some-unmapped-rule', // unknown → raw id
      impact: 'moderate', // defaulted
    });
    expect(result[0]!.nodes[0]!.failureSummary).toBe(''); // defaulted
  });

  it('honors PUPPETEER_EXECUTABLE_PATH when set', async () => {
    process.env['PUPPETEER_EXECUTABLE_PATH'] = '/opt/chrome';
    const { launch } = mockDeps();
    const scanWithCookies = await importScanner();

    await scanWithCookies('.', { url: 'https://x', cookies: COOKIES });

    expect(launch).toHaveBeenCalledWith({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath: '/opt/chrome',
    });
  });

  it('supports a module without a default export', async () => {
    const { launch } = mockDeps({ noDefaultExport: true });
    const scanWithCookies = await importScanner();

    await scanWithCookies('.', { url: 'https://x', cookies: COOKIES });

    expect(launch).toHaveBeenCalled();
  });

  it('throws a helpful error when puppeteer-core is unavailable', async () => {
    vi.doMock('puppeteer-core', () => {
      throw new Error('not installed');
    });
    const scanWithCookies = await importScanner();

    await expect(
      scanWithCookies('.', { url: 'https://x', cookies: COOKIES }),
    ).rejects.toThrow(/requires puppeteer-core/);
  });

  it('throws a helpful error when @axe-core/puppeteer is unavailable', async () => {
    vi.doMock('puppeteer-core', () => ({ default: { launch: vi.fn() } }));
    vi.doMock('@axe-core/puppeteer', () => {
      throw new Error('not installed');
    });
    const scanWithCookies = await importScanner();

    await expect(
      scanWithCookies('.', { url: 'https://x', cookies: COOKIES }),
    ).rejects.toThrow(/requires @axe-core\/puppeteer/);
  });
});
