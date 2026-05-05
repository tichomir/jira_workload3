import { describe, it, expect, vi } from 'vitest';
import { scanFile } from '../../src/workload/sdi/scanDispatcher.js';

describe('scanDispatcher — file class routing', () => {
  it('routes .csv to tabular class and detects email per row', () => {
    const buf = Buffer.from('email,name\nhello@example.com,Alice\n');
    const result = scanFile('export.csv', buf);
    expect(result.class).toBe('tabular');
    expect(result.email).toBe(1);
  });

  it('routes .tsv to tabular class', () => {
    const buf = Buffer.from('key\tvalue\nfoo\tbar\n');
    const result = scanFile('data.tsv', buf);
    expect(result.class).toBe('tabular');
  });

  it('routes .xlsx to tabular class, returns zeros, and does not throw', () => {
    const buf = Buffer.from('\x50\x4B\x03\x04');
    const result = scanFile('report.xlsx', buf);
    expect(result.class).toBe('tabular');
    expect(result.email).toBe(0);
    expect(result.apiKey).toBe(0);
    expect(result.cc).toBe(0);
    expect(result.phone).toBe(0);
  });

  it('routes .env (with extension) to dev-config class', () => {
    const buf = Buffer.from('API_KEY=sk_live_abcdefghijklmnopqrstuvwx\n');
    const result = scanFile('config.env', buf);
    expect(result.class).toBe('dev-config');
    expect(result.apiKey).toBeGreaterThan(0);
  });

  it('routes .env (basename .env) to dev-config class', () => {
    const buf = Buffer.from('SECRET=hello@test.com\n');
    const result = scanFile('/project/.env', buf);
    expect(result.class).toBe('dev-config');
    expect(result.email).toBe(1);
  });

  it('routes .env.local (basename .env.local) to dev-config class', () => {
    const buf = Buffer.from('DB_URL=postgres://user:pass@host/db\n');
    const result = scanFile('.env.local', buf);
    expect(result.class).toBe('dev-config');
  });

  it('routes .yaml to dev-config class', () => {
    const buf = Buffer.from('email: admin@example.com\n');
    const result = scanFile('config.yaml', buf);
    expect(result.class).toBe('dev-config');
    expect(result.email).toBe(1);
  });

  it('routes .yml to dev-config class', () => {
    const buf = Buffer.from('host: api.example.com\n');
    const result = scanFile('settings.yml', buf);
    expect(result.class).toBe('dev-config');
  });

  it('routes .json to dev-config class', () => {
    const buf = Buffer.from('{"contact":"user@corp.io"}');
    const result = scanFile('manifest.json', buf);
    expect(result.class).toBe('dev-config');
    expect(result.email).toBe(1);
  });

  it('routes .toml to dev-config class', () => {
    const buf = Buffer.from('[database]\nurl = "postgres://host/db"\n');
    const result = scanFile('Cargo.toml', buf);
    expect(result.class).toBe('dev-config');
  });

  it('routes .properties to dev-config class', () => {
    const buf = Buffer.from('mail.from=noreply@example.com\n');
    const result = scanFile('application.properties', buf);
    expect(result.class).toBe('dev-config');
    expect(result.email).toBe(1);
  });

  it('routes .config to dev-config class', () => {
    const buf = Buffer.from('server=api.internal\n');
    const result = scanFile('app.config', buf);
    expect(result.class).toBe('dev-config');
  });

  it('routes .txt to text-log class', () => {
    const buf = Buffer.from('Contact us at +12025551234 anytime\n');
    const result = scanFile('notes.txt', buf);
    expect(result.class).toBe('text-log');
    expect(result.phone).toBeGreaterThan(0);
  });

  it('routes .log to text-log class', () => {
    const buf = Buffer.from('INFO: server started\n');
    const result = scanFile('app.log', buf);
    expect(result.class).toBe('text-log');
  });

  it('routes .md to text-log class', () => {
    const buf = Buffer.from('# Readme\nContact: support@example.com\n');
    const result = scanFile('README.md', buf);
    expect(result.class).toBe('text-log');
    expect(result.email).toBe(1);
  });

  it('routes .xml (entities.xml) to xml class, strips tags before scanning', () => {
    const buf = Buffer.from('<issue><email>user@test.com</email></issue>');
    const result = scanFile('entities.xml', buf);
    expect(result.class).toBe('xml');
    expect(result.email).toBe(1);
  });

  it('does not detect email inside XML tags themselves', () => {
    const buf = Buffer.from('<tag data="safe">plain text only</tag>');
    const result = scanFile('data.xml', buf);
    expect(result.class).toBe('xml');
    expect(result.email).toBe(0);
  });
});

describe('scanDispatcher — unsupported file types', () => {
  it('returns all-zero counts for .png', () => {
    const buf = Buffer.from('hello@example.com');
    const result = scanFile('image.png', buf);
    expect(result.class).toBe('unsupported');
    expect(result.email).toBe(0);
    expect(result.apiKey).toBe(0);
    expect(result.cc).toBe(0);
    expect(result.phone).toBe(0);
  });

  it('returns all-zero counts for .pdf', () => {
    const buf = Buffer.from('%PDF-1.4 user@example.com');
    const result = scanFile('document.pdf', buf);
    expect(result.class).toBe('unsupported');
    expect(result.email).toBe(0);
  });

  it('returns all-zero counts for .mp4', () => {
    const buf = Buffer.from('\x00\x00\x00\x20');
    const result = scanFile('video.mp4', buf);
    expect(result.class).toBe('unsupported');
    expect(result.email).toBe(0);
  });
});

describe('scanDispatcher — xlsx-skipped log', () => {
  it('logs [sdi] xlsx-skipped for .xlsx files', () => {
    const logSpy = vi.spyOn(console, 'log');
    const buf = Buffer.from('\x50\x4B');
    scanFile('spreadsheet.xlsx', buf);
    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((m) => m.includes('[sdi] xlsx-skipped') && m.includes('reason=no-parser'))).toBe(true);
    logSpy.mockRestore();
  });
});

describe('scanDispatcher — structured log line', () => {
  it('emits [sdi] scan log with all four detector counts', () => {
    const logSpy = vi.spyOn(console, 'log');
    const buf = Buffer.from('# Notes\nContact: hello@example.com\n');
    scanFile('notes.txt', buf);
    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    const scanLine = calls.find((m) => m.startsWith('[sdi] scan'));
    expect(scanLine).toBeDefined();
    expect(scanLine).toMatch(/path=notes\.txt/);
    expect(scanLine).toMatch(/class=text-log/);
    expect(scanLine).toMatch(/email=\d+/);
    expect(scanLine).toMatch(/apiKey=\d+/);
    expect(scanLine).toMatch(/cc=\d+/);
    expect(scanLine).toMatch(/phone=\d+/);
    logSpy.mockRestore();
  });

  it('emits [sdi] scan class=unsupported for .png files', () => {
    const logSpy = vi.spyOn(console, 'log');
    const buf = Buffer.from('data');
    scanFile('photo.png', buf);
    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    const scanLine = calls.find((m) => m.includes('[sdi] scan') && m.includes('class=unsupported'));
    expect(scanLine).toBeDefined();
    logSpy.mockRestore();
  });
});
