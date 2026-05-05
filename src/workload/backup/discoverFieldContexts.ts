/**
 * Custom field context discovery for the Jira Cloud backup engine.
 *
 * Calls GET /rest/api/3/field once to enumerate all fields, then for each
 * field where custom === true calls GET /rest/api/3/field/{id}/context.
 * System fields (custom === false) are never passed to the context endpoint;
 * each one produces a [field-context] skip log line.
 *
 * Source: T2 §6 Constraint 7, T3 §4.2.
 */

import type { IJiraHttpClient, FieldContextRecord, FieldContext } from './types.js';

interface JiraField {
  id: string;
  name: string;
  custom: boolean;
}

interface FieldContextPage {
  startAt: number;
  maxResults: number;
  isLast?: boolean;
  values: Array<{
    id: string;
    name: string;
    isGlobalContext: boolean;
    isAnyIssueType: boolean;
  }>;
}

/**
 * Discover field contexts for all custom fields on the site.
 *
 * For each field returned by GET /rest/api/3/field:
 *   - custom: false → emits [field-context] skip log, skips context endpoint.
 *   - custom: true  → calls GET /rest/api/3/field/{id}/context (paginated),
 *                     emits [field-context] fetch log, appends FieldContextRecord.
 *
 * @param client       Authenticated HTTP client.
 * @param cloudBaseUrl Base URL for the site, e.g. https://api.atlassian.com/ex/jira/{cloudId}
 */
export async function discoverFieldContexts(
  client: IJiraHttpClient,
  cloudBaseUrl: string
): Promise<FieldContextRecord[]> {
  const fields = await client.getJson<JiraField[]>(cloudBaseUrl, '/rest/api/3/field');
  const results: FieldContextRecord[] = [];

  for (const field of fields) {
    if (!field.custom) {
      console.log(`[field-context] skip field=${field.id} reason=system`);
      continue;
    }

    const contexts: FieldContext[] = [];
    let startAt = 0;

    while (true) {
      const page = await client.getJson<FieldContextPage>(
        cloudBaseUrl,
        `/rest/api/3/field/${encodeURIComponent(field.id)}/context`,
        { startAt: String(startAt), maxResults: '50' }
      );

      for (const ctx of page.values) {
        contexts.push({
          id: ctx.id,
          name: ctx.name,
          isGlobalContext: ctx.isGlobalContext,
          isAnyIssueType: ctx.isAnyIssueType,
        });
      }

      if (page.isLast === true || page.values.length < page.maxResults) break;
      startAt += page.maxResults;
    }

    console.log(`[field-context] fetch field_id=${field.id} contextCount=${contexts.length}`);
    results.push({ fieldId: field.id, fieldName: field.name, custom: true, contexts });
  }

  return results;
}
