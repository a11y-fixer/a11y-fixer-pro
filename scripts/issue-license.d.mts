// Type declarations for the license-signing CLI's exported signing path,
// consumed by packages/github-action/src/license-signing.test.ts.

export interface LicensePayload {
  v: 1;
  sub: string;
  exp: number;
}

export interface SignLicenseOptions {
  /** Subject — customer id or email. */
  sub: string;
  /** Validity window in days from `now`. Must be a positive number. */
  days: number;
  /** PKCS#8 PEM of the Ed25519 private signing key. */
  pem: string;
  /** Issuance time; defaults to `new Date()`. Injectable for tests. */
  now?: Date;
}

export interface SignLicenseResult {
  /** Compact `<payloadB64>.<sigB64>` license token. */
  token: string;
  payload: LicensePayload;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
}

/** Mints and signs a license token. See scripts/issue-license.mjs. */
export function signLicense(opts: SignLicenseOptions): SignLicenseResult;
