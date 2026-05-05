import { describe, it, expect } from 'vitest';
import {
  detectEmails,
  detectApiKeys,
  detectCreditCards,
  detectPhones,
} from '../../src/workload/sdi/detectors.js';

// ---------------------------------------------------------------------------
// detectEmails
// ---------------------------------------------------------------------------

describe('detectEmails — positive cases', () => {
  it('detects a standard email address', () => {
    expect(detectEmails('Contact us at hello@example.com for help')).toBe(1);
  });

  it('detects multiple email addresses in the same buffer', () => {
    expect(detectEmails('From: alice@corp.io, To: bob@firm.net')).toBe(2);
  });

  it('detects an email with dots, underscores, and plus in local part', () => {
    expect(detectEmails('reply to user.name+tag@sub.domain.org')).toBe(1);
  });
});

describe('detectEmails — negative cases', () => {
  it('does not match a bare domain with no local part', () => {
    expect(detectEmails('@example.com')).toBe(0);
  });

  it('does not match a string with no @ sign', () => {
    expect(detectEmails('no-email-here whatsoever')).toBe(0);
  });

  it('returns 0 for an empty buffer', () => {
    expect(detectEmails('')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectApiKeys
// ---------------------------------------------------------------------------

describe('detectApiKeys — positive cases (prefixed tokens)', () => {
  it('detects an AWS AKIA access key', () => {
    // AKIA + exactly 16 uppercase alphanumeric chars
    expect(detectApiKeys('AWS_KEY=AKIAIOSFODNN7EXAMPLE')).toBeGreaterThan(0);
  });

  it('detects a GitHub personal access token (ghp_)', () => {
    const token = 'ghp_' + 'a'.repeat(36);
    expect(detectApiKeys(`GITHUB_TOKEN=${token}`)).toBeGreaterThan(0);
  });

  it('detects a Stripe live secret key (sk_live_)', () => {
    // Split prefix at runtime so GitHub Push Protection's secret-scanner
    // does not flag this fixture as a real Stripe key.
    const stripePrefix = 'sk_' + 'live_';
    expect(
      detectApiKeys(`STRIPE_KEY=${stripePrefix}abcdefghijklmnopqrstuvwx`),
    ).toBeGreaterThan(0);
  });
});

describe('detectApiKeys — positive cases (high-entropy generic tokens)', () => {
  it('detects a 39-char fully unique alphanumeric token (entropy ~5.3 bits)', () => {
    // All 39 chars distinct → entropy = log2(39) ≈ 5.28
    const token = 'aB3xKm9pQrZnWvT2yLcDfHjEuIoNsSgY7eVb8wC';
    expect(detectApiKeys(token)).toBeGreaterThan(0);
  });

  it('detects a 38-char alphanumeric token with broad character diversity (entropy ~4.8)', () => {
    // 24 singletons + 5 repeated chars → entropy ≈ 4.84 bits > threshold
    const token = 'Th3QuickBr0wnF0xJumps0verL4zyD0gSecret';
    expect(detectApiKeys(token)).toBeGreaterThan(0);
  });
});

describe('detectApiKeys — negative cases', () => {
  it('does not count a string of 40 repeated characters (entropy = 0)', () => {
    expect(detectApiKeys('a'.repeat(40))).toBe(0);
  });

  it('does not count a repeating word pattern (entropy ~2.75 bits)', () => {
    // 'password' ×5 → only 7 unique chars → low entropy
    expect(detectApiKeys('passwordpasswordpasswordpasswordpassword')).toBe(0);
  });

  it('does not count a version string with no long token', () => {
    expect(
      detectApiKeys('release v1.0.0-alpha build notes for the project'),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectCreditCards
// ---------------------------------------------------------------------------

describe('detectCreditCards — positive cases (Luhn-valid numbers)', () => {
  it('detects a 16-digit Visa test card (4111111111111111)', () => {
    expect(detectCreditCards('Card: 4111111111111111')).toBe(1);
  });

  it('detects a space-separated 16-digit Visa card (4532 0151 1283 0366)', () => {
    expect(detectCreditCards('4532 0151 1283 0366')).toBe(1);
  });

  it('detects a 15-digit Amex test card (378282246310005)', () => {
    expect(detectCreditCards('AmEx: 378282246310005')).toBe(1);
  });
});

describe('detectCreditCards — negative cases', () => {
  it('does not count a 16-digit number that fails Luhn check', () => {
    // 4111111111111112 — last digit changed from 1 to 2 → Luhn fails
    expect(detectCreditCards('4111111111111112')).toBe(0);
  });

  it('does not count a version string with dot-separated digit groups', () => {
    expect(detectCreditCards('Build 2024.01.15.0001 released')).toBe(0);
  });

  it('returns 0 for plain text with no digit sequences', () => {
    expect(detectCreditCards('no card information here at all')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// detectPhones
// ---------------------------------------------------------------------------

describe('detectPhones — positive cases', () => {
  it('detects an E.164 international phone number (+12025551234)', () => {
    expect(detectPhones('Call us at +12025551234 anytime')).toBeGreaterThan(0);
  });

  it('detects a North American number with dash separators (800-555-1234)', () => {
    expect(detectPhones('Reach us at 800-555-1234')).toBeGreaterThan(0);
  });

  it('detects a North American number with parentheses ((202) 555-0100)', () => {
    expect(detectPhones('Office: (202) 555-0100')).toBeGreaterThan(0);
  });
});

describe('detectPhones — negative cases', () => {
  it('does not match an IPv4 address', () => {
    expect(detectPhones('Server at 192.168.1.100')).toBe(0);
  });

  it('does not match a short 5-digit numeric string', () => {
    expect(detectPhones('ID: 12345')).toBe(0);
  });

  it('returns 0 for an empty buffer', () => {
    expect(detectPhones('')).toBe(0);
  });
});
