#!/usr/bin/env node
// Mint an a11y-fixer-pro license key.
//
// Usage:
//   node scripts/issue-license.mjs --sub "customer@example.com" --days 365 \
//     --key /path/to/a11y-fixer-pro-LICENSE-SIGNING-KEY.pem
//
// The private signing key is NEVER committed. Pass it with --key, or set
// LICENSE_SIGNING_KEY to its PEM contents (e.g. in a secrets manager).
//
// The emitted token is `<payload>.<signature>` (base64url), verified at runtime
// by packages/github-action/src/license.ts against the embedded public key.

import { createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
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

const exp = Math.floor(Date.now() / 1000) + Math.round(days * 86400);
const payload = { v: 1, sub, exp };
const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');

const privateKey = createPrivateKey(pem);
const sig = cryptoSign(null, Buffer.from(payloadB64, 'ascii'), privateKey).toString('base64url');

const token = `${payloadB64}.${sig}`;
console.error(`Issued license for ${sub}, expires ${new Date(exp * 1000).toISOString().slice(0, 10)}:`);
console.log(token);
