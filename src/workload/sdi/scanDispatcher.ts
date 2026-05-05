import path from 'path';
import { detectEmails, detectApiKeys, detectCreditCards, detectPhones } from './detectors.js';

export interface ScanResult {
  email: number;
  apiKey: number;
  cc: number;
  phone: number;
  class: string;
}

type FileClass = 'tabular' | 'dev-config' | 'text-log' | 'xml' | 'unsupported';

function classifyFile(filePath: string): FileClass {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (ext === '.csv' || ext === '.tsv' || ext === '.xlsx') return 'tabular';
  if (['.yaml', '.yml', '.json', '.toml', '.properties', '.config', '.env'].includes(ext)) return 'dev-config';
  if (ext === '.txt' || ext === '.log' || ext === '.md') return 'text-log';
  if (ext === '.xml') return 'xml';

  // .env files have no extension when named `.env`, `.env.local`, etc.
  if (basename === '.env' || basename.startsWith('.env.')) return 'dev-config';

  return 'unsupported';
}

function stripXmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

function detect(text: string): { email: number; apiKey: number; cc: number; phone: number } {
  return {
    email: detectEmails(text),
    apiKey: detectApiKeys(text),
    cc: detectCreditCards(text),
    phone: detectPhones(text),
  };
}

export function scanFile(filePath: string, buffer: Buffer): ScanResult {
  const fileClass = classifyFile(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (fileClass === 'unsupported') {
    console.log(`[sdi] scan path=${filePath} class=unsupported email=0 apiKey=0 cc=0 phone=0`);
    return { email: 0, apiKey: 0, cc: 0, phone: 0, class: 'unsupported' };
  }

  if (ext === '.xlsx') {
    console.log(`[sdi] xlsx-skipped path=${filePath} reason=no-parser`);
    console.log(`[sdi] scan path=${filePath} class=tabular email=0 apiKey=0 cc=0 phone=0`);
    return { email: 0, apiKey: 0, cc: 0, phone: 0, class: 'tabular' };
  }

  let text = buffer.toString('utf-8');

  if (fileClass === 'xml') {
    text = stripXmlTags(text);
  }

  let counts: { email: number; apiKey: number; cc: number; phone: number };

  if (fileClass === 'tabular') {
    counts = { email: 0, apiKey: 0, cc: 0, phone: 0 };
    for (const row of text.split(/\r?\n/)) {
      const r = detect(row);
      counts.email += r.email;
      counts.apiKey += r.apiKey;
      counts.cc += r.cc;
      counts.phone += r.phone;
    }
  } else {
    counts = detect(text);
  }

  console.log(
    `[sdi] scan path=${filePath} class=${fileClass} email=${counts.email} apiKey=${counts.apiKey} cc=${counts.cc} phone=${counts.phone}`,
  );

  return { ...counts, class: fileClass };
}
