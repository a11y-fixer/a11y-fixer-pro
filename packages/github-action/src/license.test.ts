import { describe, it, expect } from 'vitest';
import { verifyLicenseKey } from './license.js';

// A real token signed by the production signing key, sub=test@example.com,
// exp=4946591047 (year ~2126). Used with an injected `now` so the suite is
// deterministic regardless of wall-clock time.
const VALID_KEY =
  'eyJ2IjoxLCJzdWIiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiZXhwIjo0OTQ2NTkxMDQ3fQ.PUo1x635LMj2Hyg5piVzY-U83FTutaRKoPF-8ioK599Oi_0QXlx8MF28dB2dY3sZE9Yl_maZ1HJObSwaSTFDBQ';
const EXP = 4946591047;
const BEFORE = new Date((EXP - 1000) * 1000);
const AFTER = new Date((EXP + 1000) * 1000);

describe('verifyLicenseKey', () => {
  it('accepts a valid, unexpired key', () => {
    const res = verifyLicenseKey(VALID_KEY, BEFORE);
    expect(res.valid).toBe(true);
    expect(res.subject).toBe('test@example.com');
    expect(res.expires).toBe(EXP);
  });

  it('rejects a valid key past its expiry', () => {
    const res = verifyLicenseKey(VALID_KEY, AFTER);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('expired');
    expect(res.subject).toBe('test@example.com');
  });

  it('rejects an empty or missing key', () => {
    expect(verifyLicenseKey(undefined).valid).toBe(false);
    expect(verifyLicenseKey('').valid).toBe(false);
    expect(verifyLicenseKey('   ', BEFORE).reason).toContain('No license key');
  });

  it('rejects a malformed key (wrong number of segments)', () => {
    expect(verifyLicenseKey('not-a-token', BEFORE).reason).toContain('Malformed');
    expect(verifyLicenseKey('a.b.c', BEFORE).reason).toContain('Malformed');
  });

  it('rejects a tampered payload (signature no longer matches)', () => {
    const [payload, sig] = VALID_KEY.split('.');
    // Flip a character in the payload; the signature is now invalid.
    const tampered = `${payload.slice(0, -2)}${payload.slice(-2) === 'AA' ? 'AB' : 'AA'}.${sig}`;
    const res = verifyLicenseKey(tampered, BEFORE);
    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/signature|JSON|payload/i);
  });

  it('rejects a tampered signature', () => {
    const [payload, sig] = VALID_KEY.split('.');
    const badSig = `${sig.slice(0, -2)}${sig.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
    const res = verifyLicenseKey(`${payload}.${badSig}`, BEFORE);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('signature');
  });
});
