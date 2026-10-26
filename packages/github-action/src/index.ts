import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  PullRequestBuilder,
  scanSource,
  dedupeFixFiles,
} from '@a11y-fixer/core';
import type { A11yViolation, FixResult } from '@a11y-fixer/core';
import { buildFullRegistry, AnthropicProvider } from '@a11y-fixer/ai';
import { verifyLicenseKey } from './license.js';
import path from 'node:path';

/**
 * Opens a PR with the applied fixes when running in a GitHub context with a
 * token. No-ops (with a log line) when nothing was applied, no files changed,
 * or no token is available — a missing PR must never fail an otherwise-successful
 * fix run.
 */
async function maybeOpenPR(
  fixes: FixResult[],
  before: A11yViolation[],
  after: A11yViolation[],
  applied: FixResult[],
  baseBranch: string,
  hasToken: boolean,
): Promise<void> {
  if (applied.length === 0) {
    core.info('No fixes were applied — skipping PR.');
    return;
  }
  if (!hasToken) {
    core.info('No github-token provided — skipping PR.');
    return;
  }

  const changedFiles = dedupeFixFiles(fixes);
  if (changedFiles.length === 0) {
    core.info('No files were changed — skipping PR.');
    return;
  }

  const { owner, repo } = github.context.repo;
  core.info(`Opening PR against ${owner}/${repo}@${baseBranch}...`);

  const prBuilder = new PullRequestBuilder({
    owner,
    repo,
    baseBranch,
    repoRoot: process.cwd(),
  });
  const pr = await prBuilder.createPR(fixes, before, after, changedFiles);

  core.setOutput('pr-url', pr.url);
  core.info(`PR created: ${pr.url}`);
}

export async function run(): Promise<void> {
  const dir = core.getInput('dir') || '.';
  const mode = core.getInput('mode') || 'check';
  const githubToken = core.getInput('github-token');
  const anthropicKey = core.getInput('anthropic-api-key');
  const url = core.getInput('url');
  // getInput, not getBooleanInput: the latter throws when the input is absent
  // (e.g. older workflow files that predate this option).
  const html = core.getInput('html').toLowerCase() === 'true';
  const baseBranch = core.getInput('base-branch') || 'main';

  // This is paid, source-available software: a valid license key is required to
  // run it. The free, deterministic engine lives in @a11y-fixer/cli on npm.
  const license = verifyLicenseKey(core.getInput('license-key'));
  if (!license.valid) {
    core.setFailed(
      `a11y-fixer-pro requires a valid license key: ${license.reason}. ` +
      'Buy one at https://a11y-fixer.com and pass it via the `license-key` input ' +
      '(store it as a repository secret). The free deterministic CLI is available ' +
      'as `@a11y-fixer/cli` on npm.',
    );
    return;
  }
  core.info(`License valid for ${license.subject} (expires ${new Date((license.expires ?? 0) * 1000).toISOString().slice(0, 10)}).`);

  if (anthropicKey) process.env['ANTHROPIC_API_KEY'] = anthropicKey;
  if (githubToken) process.env['GITHUB_TOKEN'] = githubToken;

  const rootDir = path.resolve(dir);

  try {
    if (mode === 'check') {
      const violations = await scanSource(rootDir, { url, html });

      if (violations.length > 0) {
        const summary = violations
          .map(v => `WCAG ${v.wcagId}: ${v.description}`)
          .join('\n');
        core.setFailed(`Found ${violations.length} accessibility violation(s):\n${summary}`);
      } else {
        core.info('No accessibility violations found. ✓');
      }
    } else if (mode === 'scan') {
      const violations = await scanSource(rootDir, { url, html });
      core.setOutput('violations', JSON.stringify(violations));
      core.info(`Found ${violations.length} violation(s).`);
    } else if (mode === 'fix') {
      // URL scanning can't reliably map live DOM nodes back to repo source, so
      // fixers would no-op and no PR could be built. Fix mode is therefore
      // static-only (JSX/HTML); `url` is honored for scan/check only.
      if (url) {
        core.warning(
          'URL fix-mode is not supported: a live URL can\'t be mapped back to ' +
          'source, so no fixes can be applied. Use mode: scan/check with `url`, ' +
          'or mode: fix with static JSX/HTML. Ignoring `url` for this fix run.',
        );
      }
      const aiProvider = new AnthropicProvider();
      // Static-only (no PuppeteerRunner): the browser screenshot path exists
      // only for URL scans, which fix mode does not support.
      const registry = buildFullRegistry(aiProvider, rootDir);

      const before = await scanSource(rootDir, { html });
      const fixes = await registry.applyAll(before);
      const applied = fixes.filter(f => f.applied);
      const after = await scanSource(rootDir, { html });

      core.setOutput('fixes-applied', String(applied.length));
      core.setOutput('violations-before', String(before.length));
      core.setOutput('violations-after', String(after.length));
      core.info(`Applied ${applied.length} fix(es). Violations: ${before.length} → ${after.length}.`);

      await maybeOpenPR(fixes, before, after, applied, baseBranch, Boolean(githubToken));
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

// Auto-invoke as the action entrypoint; suppressed under vitest, where the
// test drives run() explicitly with controlled inputs.
if (!process.env['VITEST']) run();
