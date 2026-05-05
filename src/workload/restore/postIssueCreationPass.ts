/**
 * Post-issue-creation pass — restores comments, subtask links, and issue links
 * after all Issue bodies have been written in the Issue phase.
 *
 * Ordering within the pass (strictly sequential):
 *   1. Comments   — POST /rest/api/3/issue/{id}/comment
 *   2. Subtask links — POST /rest/api/3/issueLink (subtask direction)
 *   3. Issue links  — POST /rest/api/3/issueLink (all other link types)
 *
 * Best-effort semantics: per-item errors are logged and counted but do NOT
 * halt the pass. The final report accumulates error counts across all types.
 * Emits a post_issue_sub_phase SSE event after each sub-phase completes.
 *
 * Source: T5 §5.2, §6.2b, OQ-5.
 */

import type {
  RestoreRunOptions,
  RestoreSseEvent,
  PostIssuePassReport,
  PostIssueSubPhase,
} from './types.js';

// ---------------------------------------------------------------------------
// Injectable dependency types
// ---------------------------------------------------------------------------

/** Backed-up data for a single issue, loaded from the backup point. */
export interface PostIssueItemData {
  /** Jira issue key, e.g. "PROJ-42". */
  issueKey: string;
  /** Comments to restore in authored order. */
  comments: Array<Record<string, unknown>>;
  /** Subtask link records to re-create via POST /rest/api/3/issueLink. */
  subtaskLinks: Array<{
    linkType: string;
    inwardIssueKey?: string;
    outwardIssueKey?: string;
  }>;
  /** Non-subtask issue link records to re-create via POST /rest/api/3/issueLink. */
  issueLinks: Array<{
    linkType: string;
    inwardIssueKey?: string;
    outwardIssueKey?: string;
  }>;
}

/** Loads the post-issue pass data for the given backup point and selection. */
export type PostIssueDataLoader = (
  backupPointId: string,
  selection: string[]
) => Promise<PostIssueItemData[]>;

/** Restores a single comment to the given issue via the Jira API. */
export type RestoreCommentFn = (
  issueKey: string,
  comment: Record<string, unknown>
) => Promise<void>;

/** Creates a single issue link (subtask or otherwise) via the Jira API. */
export type RestoreIssueLinkFn = (
  linkType: string,
  inwardIssueKey?: string,
  outwardIssueKey?: string
) => Promise<void>;

/** Injectable dependencies for the post-issue-creation pass. */
export interface PostIssuePassDeps {
  loadItems: PostIssueDataLoader;
  restoreComment: RestoreCommentFn;
  restoreIssueLink: RestoreIssueLinkFn;
}

// ---------------------------------------------------------------------------
// Default no-op implementations (used when no real Jira client is wired)
// ---------------------------------------------------------------------------

export const defaultPostIssuePassDeps: PostIssuePassDeps = {
  loadItems: async () => [],
  restoreComment: async () => {},
  restoreIssueLink: async () => {},
};

// ---------------------------------------------------------------------------
// Pass implementation
// ---------------------------------------------------------------------------

function emitSubPhaseEvent(
  onEvent: (event: RestoreSseEvent) => void,
  jobId: string,
  subPhase: PostIssueSubPhase,
  restored: number,
  errors: number
): void {
  onEvent({
    type: 'post_issue_sub_phase',
    jobId,
    ts: new Date().toISOString(),
    subPhase,
    restored,
    errors,
    attempted: restored + errors,
  });
}

/**
 * Executes the post-issue-creation pass for the given restore job options.
 *
 * Returns the aggregate restoredCount and errorCount for the phase, plus
 * a detailed PostIssuePassReport broken down by sub-phase.
 */
export async function runPostIssueCreationPass(
  options: RestoreRunOptions,
  onEvent: (event: RestoreSseEvent) => void,
  deps: PostIssuePassDeps
): Promise<{ restoredCount: number; errorCount: number; report: PostIssuePassReport }> {
  const { jobId, backupPointId, selection } = options;
  const { loadItems, restoreComment, restoreIssueLink } = deps;

  const items = await loadItems(backupPointId, selection);

  let commentsRestored = 0;
  let commentErrors = 0;
  let subtaskLinksRestored = 0;
  let subtaskLinkErrors = 0;
  let issueLinksRestored = 0;
  let issueLinkErrors = 0;

  // Sub-phase 1: Comments
  for (const item of items) {
    for (const comment of item.comments) {
      try {
        await restoreComment(item.issueKey, comment);
        commentsRestored++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(
          `[restore] post-issue-pass subPhase=comment issueKey=${item.issueKey} outcome=error err=${message}`
        );
        commentErrors++;
      }
    }
  }
  emitSubPhaseEvent(onEvent, jobId, 'comment', commentsRestored, commentErrors);

  // Sub-phase 2: Subtask links
  for (const item of items) {
    for (const link of item.subtaskLinks) {
      try {
        await restoreIssueLink(link.linkType, link.inwardIssueKey, link.outwardIssueKey);
        subtaskLinksRestored++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(
          `[restore] post-issue-pass subPhase=subtask issueKey=${item.issueKey} outcome=error err=${message}`
        );
        subtaskLinkErrors++;
      }
    }
  }
  emitSubPhaseEvent(onEvent, jobId, 'subtask', subtaskLinksRestored, subtaskLinkErrors);

  // Sub-phase 3: Issue links
  for (const item of items) {
    for (const link of item.issueLinks) {
      try {
        await restoreIssueLink(link.linkType, link.inwardIssueKey, link.outwardIssueKey);
        issueLinksRestored++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(
          `[restore] post-issue-pass subPhase=issuelink issueKey=${item.issueKey} outcome=error err=${message}`
        );
        issueLinkErrors++;
      }
    }
  }
  emitSubPhaseEvent(onEvent, jobId, 'issuelink', issueLinksRestored, issueLinkErrors);

  const totalRestoredCount = commentsRestored + subtaskLinksRestored + issueLinksRestored;
  const totalErrorCount = commentErrors + subtaskLinkErrors + issueLinkErrors;

  const report: PostIssuePassReport = {
    commentsRestored,
    commentErrors,
    attachmentsRestored: 0,
    attachmentErrors: 0,
    subtaskLinksRestored,
    subtaskLinkErrors,
    issueLinksRestored,
    issueLinkErrors,
    adfMediaLinkWarning: false,
    adfMediaLinkAffectedIssueKeys: [],
  };

  return { restoredCount: totalRestoredCount, errorCount: totalErrorCount, report };
}
