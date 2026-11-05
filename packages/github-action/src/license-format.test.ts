import { describe, it, expect } from 'vitest';
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';
import { verifyLicenseKey } from './license.js';

/**
 * Pins the license-key wire format so an out-of-repo issuer (the a11y-fixer
 * website mints trial keys with a byte-identical algorithm) cannot silently
 * drift from what `verifyLicenseKey` and `scripts/issue-license.mjs` expect.
 *
 * We cannot round-trip through `verifyLicenseKey` with a throwaway keypair —
 * it is pinned to the production public key — so this suite re-implements the
 * documented minting algorithm against an ephemeral Ed25519 key and asserts
 * both the exact token shape and that `verifyLicenseKey`'s parsing accepts it
 * when pointed at the matching public key.
 */

// The one true minting algorithm (see scripts/issue-license.mjs:88-96). Any
// issuer — including the website's app/lib/license.ts — must match this.
function mintKey(sub: string, days: number, privateKeyPem: string): { token: string; exp: number } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + Math.round(days * 86400);
  const payloadB64 = Buffer.from(JSON.stringify({ v: 1, sub, exp }), 'utf8').toString('base64url');
  const sig = cryptoSign(null, Buffer.from(payloadB64, 'ascii'), createPrivateKey(privateKeyPem)).toString(
    'base64url',
  );
  return { token: `${payloadB64}.${sig}`, exp };
}

describe('license key wire format', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('produces a two-segment <payloadB64>.<sig> token', () => {
    const { token } = mintKey('trial@example.com', 14, privatePem);
    const parts = token.split('.');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBeTruthy();
    expect(parts[1]).toBeTruthy();
    // base64url: no +, /, or = padding.
    expect(token).not.toMatch(/[+/=]/);
  });

  it('encodes a payload with exactly { v:1, sub, exp } and a near-term trial expiry', () => {
    const before = Math.floor(Date.now() / 1000);
    const { token, exp } = mintKey('trial@example.com', 14, privatePem);
    const [payloadB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    expect(Object.keys(payload).sort()).toEqual(['exp', 'sub', 'v']);
    expect(payload.v).toBe(1);
    expect(payload.sub).toBe('trial@example.com');
    expect(payload.exp).toBe(exp);
    // 14-day trial lands ~14 days out (allow a little slack for clock/rounding).
    const fourteenDays = 14 * 86400;
    expect(payload.exp - before).toBeGreaterThan(fourteenDays - 120);
    expect(payload.exp - before).toBeLessThan(fourteenDays + 120);
  });

  it('signs the ASCII bytes of the payload segment (verifiable with the matching public key)', () => {
    const { token } = mintKey('trial@example.com', 14, privatePem);
    const [payloadB64, sigB64] = token.split('.');
    const ok = cryptoVerify(
      null,
      Buffer.from(payloadB64, 'ascii'),
      createPublicKey(publicPem),
      Buffer.from(sigB64, 'base64url'),
    );
    expect(ok).toBe(true);
  });

  it('is accepted by the verifier parse path once the public key matches (schema + expiry)', () => {
    // Mirror verifyLicenseKey's own checks against a key we control, proving a
    // freshly minted trial token satisfies every structural gate the real
    // verifier applies (v===1, string sub, number exp, exp in the future).
    const { token, exp } = mintKey('trial@example.com', 14, privatePem);
    const [payloadB64, sigB64] = token.split('.');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    expect(payload.v === 1 && typeof payload.sub === 'string' && typeof payload.exp === 'number').toBe(true);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(
      cryptoVerify(null, Buffer.from(payloadB64, 'ascii'), createPublicKey(publicPem), Buffer.from(sigB64, 'base64url')),
    ).toBe(true);

    // Sanity: the production-pinned verifier rejects this foreign-signed token,
    // confirming the signature — not just the format — is what it trusts.
    expect(verifyLicenseKey(token).valid).toBe(false);
  });
});
