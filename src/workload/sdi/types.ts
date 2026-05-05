export interface SdiRegulations {
  gdpr: 'active' | 'inactive';
  pciDss: 'active' | 'inactive';
}

export interface BackupPointSdiSummary {
  backupPointId: string;
  issueCount: number;
  projectCount: number;
  regulations: SdiRegulations;
}
