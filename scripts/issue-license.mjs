#!/usr/bin/env node
// Mint an a11y-fixer-pro license key.
//
// Usage:
//   node scripts/issue-license.mjs --sub "customer@example.com" --days 365 \
//     --key /path/to/a11y-fixer-pro-LICENSE-SIGNING-KEY.pem
//
// Each issued key is also appended to a local ledger (default .licenses/ledger.jsonl)
// so you can answer "how many people have a license?". List it with:
//   node scripts/issue-license.mjs --list
//
// The private signing key is NEVER committed. Pass it with --key, or set
// LICENSE_SIGNING_KEY to its PEM contents (e.g. in a secrets manager).
//
// The emitted token is `<payload>.<signature>` (base64url), verified at runtime
// by packages/github-action/src/license.ts against the embedded public key.
//
// The signing algorithm lives in `signLicense()` below and is exported so tests
// can exercise the real minting path (see license-signing.test.ts) rather than a
// re-implementation that could silently drift from this file.

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv as processArgv } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The one true minting algorithm. Produces the compact `<payloadB64>.<sigB64>`
 * token that packages/github-action/src/license.ts verifies. Any other issuer
 * (e.g. the trial-key website) must match this byte-for-byte.
 *
 * @param {{ sub: string, days: number, pem: string, now?: Date }} opts
 * @returns {{ token: string, payload: { v: 1, sub: string, exp: number }, iat: number, exp: number }}
 */
export function signLicense({ sub, days, pem, now = new Date() }) {
  if (!sub || typeof sub !== 'string') {
    throw new Error('signLicense: `sub` (customer id/email) is required.');
  }
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error('signLicense: `days` must be a positive number.');
  }
  if (!pem) {
    throw new Error('signLicense: `pem` signing key is required.');
  }

  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + Math.round(days * 86400);
  const payload = { v: 1, sub, exp };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

  const privateKey = createPrivateKey(pem);
  const sig = cryptoSign(null, Buffer.from(payloadB64, 'ascii'), privateKey).toString('base64url');

  return { token: `${payloadB64}.${sig}`, payload, iat, exp };
}

function arg(name, fallback) {
  const i = processArgv.indexOf(`--${name}`);
  return i !== -1 && processArgv[i + 1] ? processArgv[i + 1] : fallback;
}

function flag(name) {
  return processArgv.includes(`--${name}`);
}

// --ledger <path> → LICENSE_LEDGER env → default. Contains customer identifiers
// (see .gitignore: .licenses/ is never committed).
function ledgerPath() {
  return arg('ledger') ?? process.env.LICENSE_LEDGER ?? '.licenses/ledger.jsonl';
}

function listLicenses() {
  const path = ledgerPath();
  if (!existsSync(path)) {
    console.log('0 licenses issued.');
    return;
  }

  const records = readFileSync(path, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const nowSec = Math.floor(Date.now() / 1000);
  const subjects = new Set(records.map(r => r.sub));
  const active = records.filter(r => typeof r.exp === 'number' && r.exp > nowSec).length;
  const expired = records.length - active;

  console.log(`${records.length} license(s) issued to ${subjects.size} subject(s).`);
  console.log(`  active:  ${active}`);
  console.log(`  expired: ${expired}`);
  console.log(`  ledger:  ${path}`);
}

function main() {
  // --list: read the ledger and print issuance counts instead of minting.
  if (flag('list')) {
    listLicenses();
    return;
  }

  const sub = arg('sub');
  const days = Number(arg('days', '365'));
  const keyPath = arg('key');

  if (!sub) {
    console.error('Error: --sub <customer id/email> is required.');
    process.exit(1);
  }
  if (!Number.isFinite(days) || days <= 0) {
    console.error('Error: --days must be a positive number.');
    process.exit(1);
  }

  const pem = process.env.LICENSE_SIGNING_KEY ?? (keyPath && readFileSync(keyPath, 'utf8'));
  if (!pem) {
    console.error('Error: provide the signing key via --key <path> or LICENSE_SIGNING_KEY.');
    process.exit(1);
  }

  const { token, iat, exp } = signLicense({ sub, days, pem });

  // Append to the local issuance ledger unless suppressed with --no-ledger.
  if (!flag('no-ledger')) {
    const path = ledgerPath();
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify({ sub, iat, exp, days })}\n`, 'utf8');
    console.error(`Recorded in ledger: ${path}`);
  }

  console.error(`Issued license for ${sub}, expires ${new Date(exp * 1000).toISOString().slice(0, 10)}:`);
  console.log(token);
}

// Run the CLI only when invoked directly (`node scripts/issue-license.mjs ...`),
// not when imported by a test. Compares the resolved entry path to this module.
if (processArgv[1] && pathToFileURL(fileURLToPath(import.meta.url)).href === pathToFileURL(processArgv[1]).href) {
  main();
}
