import { describe, it, expect } from 'vitest';
import { buildSdiDisplay } from './SdiTeaserPanel.js';

describe('buildSdiDisplay', () => {
  it('active state: showBadge true when issueCount > 0, GDPR active chip', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-1',
      issueCount: 5,
      projectCount: 2,
      regulations: [
        { code: 'GDPR', status: 'active' },
        { code: 'PCI_DSS', status: 'inactive' },
      ],
    });

    expect(display.showBadge).toBe(true);
    expect(display.subtext).toBe('5 issues across 2 projects');
    expect(display.chips).toHaveLength(2);
    expect(display.chips.find((c) => c.code === 'GDPR')?.active).toBe(true);
    expect(display.chips.find((c) => c.code === 'PCI_DSS')?.active).toBe(false);
  });

  it('inactive state: showBadge false when issueCount = 0, all chips inactive', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-2',
      issueCount: 0,
      projectCount: 0,
      regulations: [
        { code: 'GDPR', status: 'inactive' },
        { code: 'PCI_DSS', status: 'inactive' },
      ],
    });

    expect(display.showBadge).toBe(false);
    expect(display.chips).toHaveLength(2);
    expect(display.chips.every((c) => !c.active)).toBe(true);
  });

  it('HIPAA chip is never included even when present in API response', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-3',
      issueCount: 10,
      projectCount: 3,
      regulations: [
        { code: 'GDPR', status: 'active' },
        { code: 'PCI_DSS', status: 'active' },
        { code: 'HIPAA', status: 'active' },
      ],
    });

    expect(display.chips.some((c) => c.code === 'HIPAA')).toBe(false);
    expect(display.chips).toHaveLength(2);
  });

  it('PCI_DSS label renders as "PCI DSS" without underscore', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-4',
      issueCount: 1,
      projectCount: 1,
      regulations: [{ code: 'PCI_DSS', status: 'active' }],
    });

    const chip = display.chips.find((c) => c.code === 'PCI_DSS');
    expect(chip?.label).toBe('PCI DSS');
  });

  it('subtext shows accurate counts', () => {
    const display = buildSdiDisplay({
      backupPointId: 'bp-5',
      issueCount: 42,
      projectCount: 7,
      regulations: [{ code: 'GDPR', status: 'active' }],
    });

    expect(display.subtext).toBe('42 issues across 7 projects');
  });
});
