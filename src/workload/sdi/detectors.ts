// RFC-5322 simplified email pattern
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Well-known API key prefixes
const API_KEY_PREFIXED_RE =
  /AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36}|ghr_[a-zA-Z0-9]{36}|xox[baprs]-[0-9a-zA-Z\-]{10,}|sk_live_[a-zA-Z0-9]{24,}|AIza[0-9A-Za-z\-_]{35}/g;

// 32+ char base64ish sequences for generic high-entropy detection
const GENERIC_TOKEN_RE = /[a-zA-Z0-9+/_\-]{32,}/g;

// Credit card number patterns (plain or space/dash separated)
const CC_RE =
  /\b(?:\d{4}[ \-]?){3}\d{1,7}\b|\b\d{4}[ \-]?\d{6}[ \-]?\d{5}\b|\b\d{13,19}\b/g;

// E.164 international phone
const PHONE_E164_RE = /\+[1-9]\d{6,14}(?!\d)/g;

// North American format: (800) 555-1234, 800-555-1234, 800.555.1234
const PHONE_NA_RE =
  /(?<!\d)(?:\+?1[ .\-]?)?\(?[2-9]\d{2}\)?[ .\-][2-9]\d{2}[ .\-]\d{4}(?!\d)/g;

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function detectEmails(buffer: string): number {
  return (buffer.match(EMAIL_RE) ?? []).length;
}

export function detectApiKeys(buffer: string): number {
  let count = 0;
  count += (buffer.match(API_KEY_PREFIXED_RE) ?? []).length;
  // Strip prefixed tokens before hunting for generic high-entropy sequences
  const stripped = buffer.replace(API_KEY_PREFIXED_RE, ' ');
  for (const token of stripped.match(GENERIC_TOKEN_RE) ?? []) {
    if (shannonEntropy(token) >= 4.0) count++;
  }
  return count;
}

export function detectCreditCards(buffer: string): number {
  let count = 0;
  for (const match of buffer.match(CC_RE) ?? []) {
    const digits = match.replace(/[ \-]/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      count++;
    }
  }
  return count;
}

export function detectPhones(buffer: string): number {
  return (
    (buffer.match(PHONE_E164_RE) ?? []).length +
    (buffer.match(PHONE_NA_RE) ?? []).length
  );
}
