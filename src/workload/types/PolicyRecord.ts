/**
 * Policy record contracts — Sprint 3, Phase 2.
 *
 * Defines the PolicyRecord shape persisted by POST /api/policies, the
 * PolicyRequest input shape, and the JQL validation flow against
 * POST /rest/api/3/jql/parse used to validate an optional jqlFilter.
 *
 * Validation flow for jqlFilter:
 *   1. POST /api/policies receives a PolicyRequest with jqlFilter present.
 *   2. Server calls POST /rest/api/3/jql/parse with { queries: [jqlFilter] }.
 *   3. If any entry in the response has a non-empty errors array, the server
 *      returns HTTP 400 { error: 'invalid_jql', details: [...] }.
 *   4. On success, the PolicyRecord is written to the store with the validated
 *      jqlFilter and returned in the HTTP 201 response.
 *
 * Source: T4 §3, T2 §6.
 */

import type { ProjectScope } from '../backup/types.js';

/**
 * Backup policy stored in the policy record store.
 *
 * Created or replaced by POST /api/policies. At most one policy exists per
 * connectionId at any time — a new POST replaces the existing record.
 *
 * Source: T4 §3.
 */
export interface PolicyRecord {
  /** Opaque policy identifier (UUID). */
  policyId: string;
  /** The connection this policy applies to. */
  connectionId: string;
  /**
   * Recovery Point Objective in hours.
   * Controls how frequently the platform schedules backup jobs.
   * Phase 1 does not expose a custom backup window in the UI (Non-Goal §3),
   * but the platform consumes this field internally.
   */
  rpoHours: number;
  /** Number of days backup points are retained before deletion. */
  retentionDays: number;
  /** Which projects are included in the backup. */
  projectScope: ProjectScope;
  /**
   * Project keys to include when projectScope === 'selected'.
   * Empty array when projectScope === 'all'.
   */
  selectedProjectKeys: string[];
  /**
   * Optional JQL filter applied on top of projectScope to further narrow
   * which Issues are backed up (e.g. "created >= -30d").
   *
   * Validated against POST /rest/api/3/jql/parse before the policy is stored.
   * Absent when no additional filter is configured.
   */
  jqlFilter?: string;
  /** ISO-8601 timestamp when this policy was first created. */
  createdAt: string;
  /** ISO-8601 timestamp when this policy was last updated. */
  updatedAt: string;
}

/**
 * Request body accepted by POST /api/policies.
 *
 * rpoHours and retentionDays are required. jqlFilter is optional; when
 * present it is validated against POST /rest/api/3/jql/parse before the
 * policy is stored (returns HTTP 400 on invalid JQL).
 */
export interface PolicyRequest {
  connectionId: string;
  rpoHours: number;
  retentionDays: number;
  projectScope: ProjectScope;
  /** Required when projectScope === 'selected'; ignored for 'all'. */
  selectedProjectKeys?: string[];
  /** Optional JQL — validated via POST /rest/api/3/jql/parse if present. */
  jqlFilter?: string;
}

/**
 * Request body sent to POST /rest/api/3/jql/parse.
 * Called only when PolicyRequest.jqlFilter is present and non-empty.
 */
export interface JqlParseRequest {
  queries: string[];
}

/**
 * Response shape from POST /rest/api/3/jql/parse.
 * A non-empty `errors` array on any entry means the JQL string is invalid;
 * the server must return HTTP 400 with error 'invalid_jql'.
 */
export interface JqlParseResponse {
  queries: Array<{
    query: string;
    /** Non-empty when the query contains a syntax error. */
    errors: string[];
  }>;
}
