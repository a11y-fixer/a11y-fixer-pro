import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/**
 * Offline license-key verification.
 *
 * A license key is a compact token `<payload>.<signature>` where:
 *   - `<payload>`   is base64url(JSON) of `{ v, sub, exp }` — schema version,
 *                   subject (customer id / email), and expiry (unix seconds).
 *   - `<signature>` is base64url of the Ed25519 signature over the ASCII bytes
 *                   of the `<payload>` segment.
 *
 * Keys are signed offline with the private signing key (kept out of this repo;
 * see scripts/issue-license.mjs) and verified here against the embedded public
 * key. No network call is made, so validation never depends on an external
 * service being up.
 */

// Ed25519 public key for license verification. Safe to ship: the matching
// private key never leaves the issuer. Rotating it is a new release.
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXFWD+e/TerlWMSd+ErgykAgvGrkddl5BFEMLRsHQONk=
-----END PUBLIC KEY-----`;

export interface LicenseResult {
  valid: boolean;
  /** Human-readable reason when `valid` is false. */
  reason?: string;
  /** Subject (customer id) when `valid` is true. */
  subject?: string;
  /** Expiry as a unix timestamp (seconds) when present. */
  expires?: number;
}

interface LicensePayload {
  v: number;
  sub: string;
  exp: number;
}

/**
 * Verifies a license key against the embedded public key and expiry.
 * `now` is injectable for testing; defaults to the current time.
 */
export function verifyLicenseKey(key: string | undefined, now: Date = new Date()): LicenseResult {
  if (!key || !key.trim()) {
    return { valid: false, reason: 'No license key provided' };
  }

  const parts = key.trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { valid: false, reason: 'Malformed license key' };
  }
  const [payloadB64, sigB64] = parts;

  let signatureOk: boolean;
  try {
    const publicKey = createPublicKey(LICENSE_PUBLIC_KEY_PEM);
    signatureOk = cryptoVerify(
      null,
      Buffer.from(payloadB64, 'ascii'),
      publicKey,
      Buffer.from(sigB64, 'base64url'),
    );
  } catch {
    return { valid: false, reason: 'License key signature could not be verified' };
  }
  if (!signatureOk) {
    return { valid: false, reason: 'Invalid license key signature' };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'License key payload is not valid JSON' };
  }

  if (payload.v !== 1 || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    return { valid: false, reason: 'Unsupported license key payload' };
  }

  const nowSec = Math.floor(now.getTime() / 1000);
  if (payload.exp <= nowSec) {
    const when = new Date(payload.exp * 1000).toISOString().slice(0, 10);
    return { valid: false, reason: `License key expired on ${when}`, subject: payload.sub, expires: payload.exp };
  }

  return { valid: true, subject: payload.sub, expires: payload.exp };
}
