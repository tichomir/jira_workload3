/**
 * Project discovery for the Jira Cloud backup engine.
 *
 * Paginates GET /rest/api/3/project/search via JiraHttpClient.getPaginated,
 * separating JSM (service_desk) projects into the deferred list and
 * honoring projectScope (all / selected).
 *
 * Source: T3 §4.3, T4 §6, T2 §6 Constraint 11.
 */

import { JiraHttpClient } from '../http/JiraHttpClient.js';
import type { ProjectRecord, JsmDeferredProject, ProjectScope } from './types.js';

/**
 * Partitions a flat array of raw API projects into included (non-JSM) and deferred (JSM).
 * service_desk projects are always deferred regardless of scope.
 */
export function partitionJsmProjects(projects: JiraApiProject[]): {
  included: JiraApiProject[];
  deferred: JsmDeferredProject[];
} {
  const included: JiraApiProject[] = [];
  const deferred: JsmDeferredProject[] = [];

  for (const proj of projects) {
    if (proj.projectTypeKey === 'service_desk') {
      deferred.push({
        projectId: proj.id,
        projectKey: proj.key,
        projectName: proj.name,
        reason: 'PHASE_2_DEFERRED',
      });
    } else {
      included.push(proj);
    }
  }

  return { included, deferred };
}

interface JiraApiProject {
  id: string;
  key: string;
  name: string;
  projectTypeKey: string;
  lead?: { accountId: string; displayName: string };
  simplified?: boolean;
  style?: string;
}

interface ProjectSearchPage {
  startAt: number;
  maxResults: number;
  total: number;
  isLast?: boolean;
  values: JiraApiProject[];
}

export interface DiscoverProjectsResult {
  /** Non-JSM projects included in the backup. Filtered by selectedKeys when scope='selected'. */
  projects: ProjectRecord[];
  /** service_desk projects deferred to Phase 2, always populated regardless of scope. */
  jsmDeferredProjects: JsmDeferredProject[];
  /**
   * Total number of API-returned projects processed (non-JSM in scope + JSM deferred).
   * When scope='all', equals the API total (zero-omissions invariant, T3 §4.3).
   */
  discoveredCount: number;
}

/**
 * Discover all Jira projects on the site, honoring projectScope.
 *
 * @param client        Authenticated JiraHttpClient for the target connection.
 * @param cloudBaseUrl  Base URL for the site, e.g. https://api.atlassian.com/ex/jira/{cloudId}.
 * @param scope         'all' returns every project; 'selected' filters by selectedKeys.
 * @param selectedKeys  Required when scope === 'selected'. Project keys to include.
 */
export async function discoverProjects(
  client: JiraHttpClient,
  cloudBaseUrl: string,
  scope: ProjectScope,
  selectedKeys?: string[]
): Promise<DiscoverProjectsResult> {
  const projects: ProjectRecord[] = [];
  const jsmDeferredProjects: JsmDeferredProject[] = [];
  let pageNum = 0;
  let totalApiCount = 0;

  await client.getPaginated<ProjectSearchPage>(
    cloudBaseUrl,
    '/rest/api/3/project/search',
    {},
    async (page) => {
      pageNum++;
      const items = page.values ?? [];
      console.log(`[discover] phase=project page=${pageNum} count=${items.length}`);

      for (const proj of items) {
        totalApiCount++;

        if (proj.projectTypeKey === 'service_desk') {
          jsmDeferredProjects.push({
            projectId: proj.id,
            projectKey: proj.key,
            projectName: proj.name,
            reason: 'PHASE_2_DEFERRED',
          });
          console.log(`[discover] jsm-deferred projectKey=${proj.key} projectId=${proj.id}`);
          continue;
        }

        if (scope === 'selected' && !(selectedKeys ?? []).includes(proj.key)) {
          continue;
        }

        projects.push({
          projectId: proj.id,
          projectKey: proj.key,
          projectName: proj.name,
          projectTypeKey: proj.projectTypeKey,
          issueCounts: { total: 0, backed: 0, errored: 0 },
          boardIds: [],
          sprintIds: [],
          changeBadge: 'added',
        });
      }

      return true;
    }
  );

  return { projects, jsmDeferredProjects, discoveredCount: totalApiCount };
}
