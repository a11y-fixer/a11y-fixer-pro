import type { CookieParam } from 'puppeteer-core';
import type { A11yViolation } from '@a11y-fixer/core';

// Mirrors AXE_WCAG_MAP from @a11y-fixer/core so violation shapes are identical.
const AXE_WCAG_MAP: Record<string, string> = {
  'image-alt': '1.1.1',
  'button-name': '4.1.2',
  'label': '1.3.1',
  'html-has-lang': '3.1.1',
  'html-lang-valid': '3.1.1',
  'html-xml-lang-mismatch': '3.1.1',
  'heading-order': '2.4.6',
  'meta-viewport': '1.4.4',
  'meta-viewport-large': '1.4.4',
  'color-contrast': '1.4.3',
  'link-name': '2.4.4',
  'video-caption': '1.2.2',
  'tabindex': '2.4.3',
  'meta-refresh': '2.2.1',
  'scrollable-region-focusable': '2.1.1',
  'aria-hidden-body': '4.1.2',
  'aria-hidden-focus': '4.1.2',
  'frame-title': '4.1.2',
  'document-title': '2.4.2',
  'blink': '2.2.2',
  'marquee': '2.2.2',
  'list': '1.3.1',
  'listitem': '1.3.1',
};

function toWcagId(axeRuleId: string): string {
  return AXE_WCAG_MAP[axeRuleId] ?? axeRuleId;
}

export async function scanWithCookies(
  _dir: string,
  { url, cookies }: { url: string; cookies: CookieParam[] },
): Promise<A11yViolation[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteerMod: any;
  try {
    puppeteerMod = await import('puppeteer-core');
  } catch {
    throw new Error(
      'Cookie-authenticated scanning requires puppeteer-core.\n' +
      'Install it: pnpm add -D puppeteer-core @axe-core/puppeteer',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let AxePuppeteer: any;
  try {
    const mod = await import('@axe-core/puppeteer');
    AxePuppeteer = mod.default;
  } catch {
    throw new Error(
      'Cookie-authenticated scanning requires @axe-core/puppeteer.\n' +
      'Install it: pnpm add -D @axe-core/puppeteer',
    );
  }

  // Mirrors launchBrowser() in @a11y-fixer/core: honors PUPPETEER_EXECUTABLE_PATH
  // so the GitHub Actions setup-chrome step points us at the right binary.
  // --no-sandbox is required on GitHub's ubuntu-latest (Ubuntu 24.04+), which
  // disables unprivileged user namespaces, so Chrome's sandbox can't start.
  const executablePath = process.env['PUPPETEER_EXECUTABLE_PATH'];
  const args = ['--no-sandbox', '--disable-setuid-sandbox'];
  const launchOpts = executablePath
    ? { headless: true as const, args, executablePath }
    : { headless: true as const, args };
  const launcher = puppeteerMod.default ?? puppeteerMod;
  const browser = await launcher.launch(launchOpts);

  try {
    const page = await browser.newPage();
    await page.setCookie(...cookies);
    await page.goto(url, { waitUntil: 'networkidle0' });
    const axe = new AxePuppeteer(page);
    const results = await axe.analyze();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return results.violations.map((v: any) => ({
      id: v.id,
      wcagId: toWcagId(v.id),
      impact: (v.impact ?? 'moderate') as A11yViolation['impact'],
      description: v.description,
      helpUrl: v.helpUrl,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nodes: v.nodes.map((n: any) => ({
        html: n.html,
        target: n.target.map(String),
        failureSummary: n.failureSummary ?? '',
      })),
    }));
  } finally {
    await browser.close();
  }
}
