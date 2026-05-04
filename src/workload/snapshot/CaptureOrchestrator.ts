/**
 * Capture-order orchestrator for the Jira Cloud snapshot phase.
 *
 * Executes phases in dependency order: CustomField → Project → Issue.
 * Emits a CaptureProgressEvent at each phase boundary and once per project
 * during Issue enumeration (heartbeat, ≤10 s contract — T5 §6.2).
 *
 * Source: T1 §1, T3 §3.4, T5 §6.2.
 */

import { discoverFieldContexts } from '../backup/discoverFieldContexts.js';
import { assembleIssuePayload, assertCoverageInvariant } from './assembleIssuePayload.js';
import type {
  IJiraHttpClient,
  ICaptureOrchestrator,
  CaptureRunOptions,
  CaptureRunResult,
  CaptureProgressEvent,
  PhaseResult,
  FieldContextRecord,
  BackupManifest,
  RawIssue,
} from '../backup/types.js';

export class CaptureOrchestrator implements ICaptureOrchestrator {
  private readonly client: IJiraHttpClient;
  private readonly manifest: BackupManifest;

  constructor(client: IJiraHttpClient, manifest: BackupManifest) {
    this.client = client;
    this.manifest = manifest;
  }

  async runCapture(
    options: CaptureRunOptions,
    onProgress: (event: CaptureProgressEvent) => void
  ): Promise<CaptureRunResult> {
    const startMs = Date.now();
    const phaseResults: PhaseResult[] = [];
    let totalItemCount = 0;
    let totalErrorCount = 0;
    let fieldContexts: FieldContextRecord[] = [];

    // -------------------------------------------------------------------------
    // Phase: CustomField
    // Calls GET /rest/api/3/field then GET /rest/api/3/field/{id}/context for
    // each custom field. System fields are skipped with a [field-context] log.
    // -------------------------------------------------------------------------
    try {
      fieldContexts = await discoverFieldContexts(this.client, options.cloudBaseUrl);
      phaseResults.push({
        phase: 'CustomField',
        status: 'ok',
        itemCount: fieldContexts.length,
        errorCount: 0,
      });
      totalItemCount += fieldContexts.length;
      onProgress({
        phase: 'CustomField',
        itemsCaptured: fieldContexts.length,
        itemsTotal: fieldContexts.length,
        elapsedMs: Date.now() - startMs,
      });
    } catch (err) {
      const diagnostic = err instanceof Error ? err.message : String(err);
      phaseResults.push({
        phase: 'CustomField',
        status: 'failed',
        itemCount: 0,
        errorCount: 1,
        diagnostic,
      });
      totalErrorCount++;
      return {
        backupPointId: options.manifestId,
        completedAt: new Date().toISOString(),
        phaseResults,
        itemCount: totalItemCount,
        errorCount: totalErrorCount,
        fieldContexts,
        phaseDiagnostic: `CustomField phase: ${diagnostic}`,
      };
    }

    // -------------------------------------------------------------------------
    // Phase: Project — projects already in manifest from discover(); no API call.
    // -------------------------------------------------------------------------
    {
      const projects = this.manifest.projects;
      phaseResults.push({
        phase: 'Project',
        status: 'ok',
        itemCount: projects.length,
        errorCount: 0,
      });
      totalItemCount += projects.length;
      onProgress({
        phase: 'Project',
        itemsCaptured: projects.length,
        itemsTotal: projects.length,
        elapsedMs: Date.now() - startMs,
      });
    }

    // -------------------------------------------------------------------------
    // Phase: Issue
    // Enumerates all issues per project via POST /rest/api/3/search/jql.
    // Emits a heartbeat event per project to satisfy the ≤10 s contract.
    // -------------------------------------------------------------------------
    {
      const allCustomFieldIds = fieldContexts.map((f) => f.fieldId);
      const projects = this.manifest.projects;
      let issueCaptured = 0;
      let issueErrorCount = 0;
      const HEARTBEAT_INTERVAL_MS = 9_000;
      let lastHeartbeatMs = Date.now();

      for (const project of projects) {
        try {
          const jql = `project = ${project.projectKey} ORDER BY created ASC`;
          const issues: RawIssue[] = await this.client.enumerateIssues(
            options.cloudBaseUrl,
            project.projectKey,
            jql,
            ['*all'],
            { maxResults: 100 }
          );

          for (const rawIssue of issues) {
            try {
              const payload = assembleIssuePayload(rawIssue, allCustomFieldIds);
              assertCoverageInvariant(payload, allCustomFieldIds);
              issueCaptured++;
            } catch (err) {
              issueErrorCount++;
              console.error(
                `[snapshot] issue-error issueId=${rawIssue.id}: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }

            // Time-based mid-page heartbeat during large pages
            const nowMs = Date.now();
            if (nowMs - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
              onProgress({
                phase: 'Issue',
                itemsCaptured: issueCaptured,
                itemsTotal: null,
                elapsedMs: nowMs - startMs,
              });
              lastHeartbeatMs = nowMs;
            }
          }

          // Per-project heartbeat — emitted after each project's issues are
          // processed, ensuring ≤10 s emission even when time-based guard skips.
          onProgress({
            phase: 'Issue',
            itemsCaptured: issueCaptured,
            itemsTotal: null,
            elapsedMs: Date.now() - startMs,
          });
          lastHeartbeatMs = Date.now();

          console.log(
            `[snapshot] project=${project.projectKey} issues=${issues.length}` +
              ` captured=${issueCaptured} errored=${issueErrorCount}`
          );
        } catch (err) {
          issueErrorCount++;
          console.error(
            `[snapshot] project-error project=${project.projectKey}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      phaseResults.push({
        phase: 'Issue',
        status: issueErrorCount > 0 ? 'partial' : 'ok',
        itemCount: issueCaptured,
        errorCount: issueErrorCount,
      });
      totalItemCount += issueCaptured;
      totalErrorCount += issueErrorCount;

      // Final Issue phase event with resolved total
      onProgress({
        phase: 'Issue',
        itemsCaptured: issueCaptured,
        itemsTotal: issueCaptured + issueErrorCount,
        elapsedMs: Date.now() - startMs,
      });
    }

    return {
      backupPointId: options.manifestId,
      completedAt: new Date().toISOString(),
      phaseResults,
      itemCount: totalItemCount,
      errorCount: totalErrorCount,
      fieldContexts,
    };
  }
}
