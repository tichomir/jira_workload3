/**
 * Atlassian native trash-window detection guard.
 *
 * Runs before the Project phase. For each project key in the selection:
 *   - Calls the configured TrashChecker to get trash status from the Jira API.
 *   - Emits a structured log line per project.
 *   - When inTrash === true AND destination === 'original', marks
 *     alternateLocationRequired and sets forcedAlternate in the result so
 *     the orchestrator can switch the effective destination to 'alternate'.
 *   - When destination === 'alternate' or 'export', always allows through.
 *
 * This guard does NOT halt execution (not a job_failed condition).
 * Source: T5 §4.2, CLAUDE.md Non-Goals.
 */

import type { TrashStatus, GuardResult, RestoreDestinationType } from './types.js';

/**
 * Queries the Atlassian Jira API for the trash status of a single project.
 * Returns all TrashStatus fields except alternateLocationRequired, which is
 * computed by the guard based on the restore destination.
 */
export type TrashChecker = (
  projectKey: string
) => Promise<Omit<TrashStatus, 'alternateLocationRequired'>>;

export interface TrashDetectionResult {
  trashStatuses: TrashStatus[];
  guardResults: GuardResult[];
  /** true when ≥1 project was trashed AND destination was 'original'. */
  forcedAlternate: boolean;
}

/**
 * Runs the trash-detection guard for a set of project keys.
 *
 * @param projectKeys  Project keys to check (e.g. ["PROJ", "ABC"]).
 * @param destination  The restore destination from RestoreRunOptions.
 * @param checkTrash   Injectable function that queries the Atlassian API.
 */
export async function runTrashDetection(
  projectKeys: string[],
  destination: RestoreDestinationType,
  checkTrash: TrashChecker
): Promise<TrashDetectionResult> {
  const trashStatuses: TrashStatus[] = [];
  const guardResults: GuardResult[] = [];
  let forcedAlternate = false;

  for (const projectKey of projectKeys) {
    const raw = await checkTrash(projectKey);

    const alternateLocationRequired = raw.inTrash && destination === 'original';

    const status: TrashStatus = { ...raw, alternateLocationRequired };
    trashStatuses.push(status);

    console.log(
      `[restore] guard=trash-detection projectKey=${projectKey} trashed=${raw.inTrash}`
    );

    if (alternateLocationRequired) {
      forcedAlternate = true;
      guardResults.push({
        passed: false,
        guardName: 'trash-detection',
        failureCode: 'project_in_trash',
        failureMessage:
          `Project ${projectKey} is in Atlassian native trash` +
          (raw.daysInTrash !== undefined ? ` (${raw.daysInTrash}d)` : '') +
          `. In-place restore blocked; forcing alternate-location restore.`,
      });
    } else {
      guardResults.push({
        passed: true,
        guardName: 'trash-detection',
      });
    }
  }

  return { trashStatuses, guardResults, forcedAlternate };
}

/**
 * Extracts unique project keys from a mixed restore selection array.
 *
 * Handles:
 *   - Issue keys ("PROJ-42") → extracts "PROJ"
 *   - Pure project keys ("PROJ") → kept as-is
 *   - Numeric IDs (board IDs, sprint IDs) → skipped
 */
export function extractProjectKeys(selection: string[]): string[] {
  const keys = new Set<string>();
  for (const item of selection) {
    const issueMatch = item.match(/^([A-Z][A-Z0-9_]*)-\d+$/);
    if (issueMatch) {
      keys.add(issueMatch[1]);
    } else if (/^[A-Z][A-Z0-9_]*$/.test(item)) {
      keys.add(item);
    }
  }
  return [...keys];
}
