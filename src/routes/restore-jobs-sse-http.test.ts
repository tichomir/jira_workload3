/**
 * Real-HTTP integration tests for GET /api/restore-jobs/:id/events (SSE endpoint).
 *
 * Unlike the mock-req/res tests, this file binds a real Express server on a
 * random port and makes actual HTTP requests, verifying the full SSE wire
 * protocol end-to-end:
 *
 *   POST /api/restore-jobs   → create job, starts orchestrator async
 *   GET  /api/restore-jobs/:id/events → reads SSE stream until stream closes
 *
 * Forced-failure scenario: Workflow phase handler throws, triggering
 * job_failed { error.code: 'dependency_phase_failed', phase: 'workflow' }.
 * The test asserts exact event payload shape and that downstream phases are
 * never started.
 *
 * Source: T5 §5.2, §6.2.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as net from 'net';
import express from 'express';
import type { AddressInfo } from 'net';
import Database from 'better-sqlite3';
import { _setDbForTesting, _resetDb } from '../db/database.js';
import {
  _setOrchestratorFactory,
  _resetOrchestratorFactory,
  restoreJobsRouter,
} from './restore-jobs.js';
import { RestoreOrchestrator } from '../workload/restore/RestoreOrchestrator.js';
import { _clearAll } from '../workload/restore/eventBus.js';
import {
  RESTORE_PHASE_ORDER,
  RestorePhase,
  type RestoreSseEvent,
  type PhaseStartedEvent,
  type JobFailedEvent,
} from '../workload/restore/types.js';

// ---------------------------------------------------------------------------
// Test DB setup
// ---------------------------------------------------------------------------

const TEST_CONN_ID = 'http-conn-001';
const TEST_CLOUD_ID = 'cloud-http-001';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE connections (
      connectionId TEXT PRIMARY KEY,
      cloudId      TEXT NOT NULL UNIQUE,
      siteName     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'active',
      createdAt    TEXT NOT NULL,
      updatedAt    TEXT NOT NULL
    );
    CREATE TABLE restore_jobs (
      jobId                TEXT    PRIMARY KEY,
      connectionId         TEXT    NOT NULL REFERENCES connections(connectionId),
      backupPointId        TEXT    NOT NULL,
      conflictMode         TEXT    NOT NULL DEFAULT 'skip',
      destination          TEXT    NOT NULL,
      selection            TEXT    NOT NULL DEFAULT '[]',
      alternateDestination TEXT,
      status               TEXT    NOT NULL DEFAULT 'queued',
      restoredCount        INTEGER NOT NULL DEFAULT 0,
      errorCount           INTEGER NOT NULL DEFAULT 0,
      phaseDiagnostic      TEXT,
      createdAt            TEXT    NOT NULL,
      completedAt          TEXT
    );
    CREATE TABLE credentials (
      connectionId TEXT PRIMARY KEY,
      accessToken  TEXT,
      refreshToken TEXT,
      expiresAt    INTEGER,
      scopes       TEXT,
      updatedAt    TEXT,
      clientId     TEXT,
      clientSecret TEXT
    );
  `);

  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO connections (connectionId, cloudId, siteName, status, createdAt, updatedAt)
     VALUES (?, ?, 'HTTP Integration Test Site', 'active', ?, ?)`
  ).run(TEST_CONN_ID, TEST_CLOUD_ID, now, now);

  db.prepare(
    `INSERT INTO credentials (connectionId, accessToken, refreshToken, expiresAt, scopes, updatedAt)
     VALUES (?, 'test-access-token', 'test-refresh-token', 9999999999,
             'write:board-scope:jira-software write:board-scope.admin:jira-software', ?)`
  ).run(TEST_CONN_ID, now);

  return db;
}

// ---------------------------------------------------------------------------
// HTTP server — started once for all tests in this file
// ---------------------------------------------------------------------------

let server: http.Server;
let port: number;
const openConnections = new Set<net.Socket>();

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      const app = express();
      app.use(express.json());
      app.use('/api/restore-jobs', restoreJobsRouter);
      server = http.createServer(app);

      server.on('connection', (socket: net.Socket) => {
        openConnections.add(socket);
        socket.on('close', () => openConnections.delete(socket));
      });

      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    })
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      for (const socket of openConnections) socket.destroy();
      server.close(() => resolve());
    })
);

beforeEach(() => {
  const db = createTestDb();
  _setDbForTesting(db);
  _clearAll();
});

afterEach(() => {
  _resetOrchestratorFactory();
  _resetDb();
  _clearAll();
});

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface PostResult {
  status: number;
  json: unknown;
}

function postJson(path: string, body: unknown): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => {
          responseBody += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, json: JSON.parse(responseBody) });
          } catch {
            reject(new Error(`Failed to parse response JSON: ${responseBody}`));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

interface SseResult {
  statusCode: number | undefined;
  contentType: string | undefined;
  events: RestoreSseEvent[];
}

/**
 * Opens a real HTTP connection to the SSE endpoint, reads all events until
 * the server closes the stream (res.end() after a terminal event), and returns
 * the parsed event list.
 *
 * Each SSE message follows the format:  event: <type>\ndata: <json>\n\n
 * Heartbeat comment lines (: heartbeat\n\n) are ignored.
 */
function readSseStream(path: string, timeoutMs = 5_000): Promise<SseResult> {
  return new Promise((resolve, reject) => {
    const events: RestoreSseEvent[] = [];
    let buffer = '';
    let settled = false;
    let statusCode: number | undefined;
    let contentType: string | undefined;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`SSE stream timed out after ${timeoutMs}ms on ${path}`));
      }
    }, timeoutMs);

    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        statusCode = res.statusCode;
        contentType = res.headers['content-type'];

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          // SSE messages are delimited by blank lines (\n\n)
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            if (!part.trim()) continue;
            const dataLine = part.split('\n').find((l) => l.startsWith('data: '));
            if (dataLine) {
              try {
                events.push(JSON.parse(dataLine.slice('data: '.length)) as RestoreSseEvent);
              } catch {
                // ignore malformed JSON (should not occur in tests)
              }
            }
          }
        });

        res.on('end', () => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            resolve({ statusCode, contentType, events });
          }
        });

        res.on('error', (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(err);
          }
        });
      }
    );

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SSE endpoint — real HTTP integration (forced-failure restore)', () => {
  it('GET returns 200 with Content-Type: text/event-stream for a known job', async () => {
    // Create a job without injecting a failing orchestrator (default stubs complete instantly)
    const createResult = await postJson('/api/restore-jobs', {
      connectionId: TEST_CONN_ID,
      backupPointId: 'bp-http-hdr-001',
      conflictMode: 'skip',
      destination: 'original',
      selection: ['PROJ-1'],
    });
    expect(createResult.status).toBe(201);
    const { jobId } = createResult.json as { jobId: string };

    const { statusCode, contentType } = await readSseStream(`/api/restore-jobs/${jobId}/events`);
    expect(statusCode).toBe(200);
    expect(contentType).toMatch(/text\/event-stream/);
  });

  it('GET returns 404 for an unknown jobId', async () => {
    const { statusCode } = await new Promise<{ statusCode: number | undefined }>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port, path: '/api/restore-jobs/no-such-job/events', method: 'GET' },
        (res) => {
          let body = '';
          res.on('data', (c: Buffer) => { body += c.toString(); });
          res.on('end', () => resolve({ statusCode: res.statusCode }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    expect(statusCode).toBe(404);
  });

  it('forced-failure: workflow phase throws → job_failed with dependency_phase_failed semantics', async () => {
    // Inject a failing orchestrator — workflow handler throws immediately
    _setOrchestratorFactory(
      () =>
        new RestoreOrchestrator({
          [RestorePhase.Workflow]: async () => {
            throw new Error('real-http injected workflow failure');
          },
        })
    );

    // Create restore job via real HTTP POST
    const createResult = await postJson('/api/restore-jobs', {
      connectionId: TEST_CONN_ID,
      backupPointId: 'bp-http-fail-001',
      conflictMode: 'skip',
      destination: 'original',
      selection: ['PROJ-1', 'PROJ-2'],
    });
    expect(createResult.status).toBe(201);
    const { jobId } = createResult.json as { jobId: string; status: string };
    expect(typeof jobId).toBe('string');
    expect(jobId.length).toBeGreaterThan(0);

    // Read SSE stream via real HTTP GET — stream closes after job_failed
    const { statusCode, contentType, events } = await readSseStream(
      `/api/restore-jobs/${jobId}/events`
    );

    // (1) Response headers
    expect(statusCode).toBe(200);
    expect(contentType).toMatch(/text\/event-stream/);

    // (2) job_failed event must be present with exact dependency_phase_failed payload
    const failedEvent = events.find((e): e is JobFailedEvent => e.type === 'job_failed');
    expect(failedEvent).toBeDefined();
    expect(failedEvent!.error.code).toBe('dependency_phase_failed');
    expect(failedEvent!.error.phase).toBe(RestorePhase.Workflow);
    expect(failedEvent!.error.message).toContain('real-http injected workflow failure');
    expect(failedEvent!.jobId).toBe(jobId);
    expect(failedEvent!.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // (3) error object has exactly: code, phase, message (no extra fields)
    expect(Object.keys(failedEvent!.error).sort()).toEqual(['code', 'message', 'phase'].sort());

    // (4) Phases before workflow (site-reference-data, project) were started
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    const workflowIdx = RESTORE_PHASE_ORDER.indexOf(RestorePhase.Workflow);
    for (const phase of RESTORE_PHASE_ORDER.slice(0, workflowIdx)) {
      expect(startedPhases).toContain(phase);
    }
    // Workflow itself was started (phase_started emitted before handler throws)
    expect(startedPhases).toContain(RestorePhase.Workflow);

    // (5) Downstream phases (custom-field onward) were NEVER started
    for (const phase of RESTORE_PHASE_ORDER.slice(workflowIdx + 1)) {
      expect(startedPhases).not.toContain(phase);
    }

    // (6) job_completed must NOT be emitted (job_failed is terminal)
    expect(events.some((e) => e.type === 'job_completed')).toBe(false);

    // (7) job_failed is the last event in the stream
    expect(events[events.length - 1].type).toBe('job_failed');
  });

  it('successful run: all 8 phases started in RESTORE_PHASE_ORDER, job_completed terminal', async () => {
    // Default stub orchestrator completes all phases
    const createResult = await postJson('/api/restore-jobs', {
      connectionId: TEST_CONN_ID,
      backupPointId: 'bp-http-success-001',
      conflictMode: 'skip',
      destination: 'original',
      selection: ['PROJ-1'],
    });
    expect(createResult.status).toBe(201);
    const { jobId } = createResult.json as { jobId: string };

    const { statusCode, events } = await readSseStream(`/api/restore-jobs/${jobId}/events`);
    expect(statusCode).toBe(200);

    // All 8 phases were started in canonical order
    const startedPhases = events
      .filter((e): e is PhaseStartedEvent => e.type === 'phase_started')
      .map((e) => e.phase);
    expect(startedPhases).toEqual([...RESTORE_PHASE_ORDER]);

    // Terminal event is job_completed
    expect(events[events.length - 1].type).toBe('job_completed');

    // No job_failed
    expect(events.some((e) => e.type === 'job_failed')).toBe(false);
  });

  it('SSE wire format: each event write starts with event: <type> followed by data: <json>', async () => {
    // Use the postJson result and SSE stream but inspect the raw SSE wire
    // by reading the raw body buffer directly.
    _setOrchestratorFactory(
      () =>
        new RestoreOrchestrator({
          [RestorePhase.Workflow]: async () => {
            throw new Error('wire-format-check failure');
          },
        })
    );

    const createResult = await postJson('/api/restore-jobs', {
      connectionId: TEST_CONN_ID,
      backupPointId: 'bp-http-wire-001',
      conflictMode: 'skip',
      destination: 'original',
      selection: ['PROJ-1'],
    });
    expect(createResult.status).toBe(201);
    const { jobId } = createResult.json as { jobId: string };

    // Read raw body to inspect SSE framing
    const rawBody = await new Promise<string>((resolve, reject) => {
      let body = '';
      const req = http.request(
        { hostname: '127.0.0.1', port, path: `/api/restore-jobs/${jobId}/events`, method: 'GET' },
        (res) => {
          res.on('data', (c: Buffer) => { body += c.toString(); });
          res.on('end', () => resolve(body));
          res.on('error', reject);
        }
      );
      req.on('error', reject);
      req.end();
    });

    // Every SSE message block (split by \n\n) that carries a data event must
    // start with "event: <type>\n" and contain a "data: <json>" line.
    const messages = rawBody.split('\n\n').filter((m) => m.trim() && !m.startsWith(':'));
    expect(messages.length).toBeGreaterThan(0);

    for (const msg of messages) {
      const lines = msg.split('\n');
      // Must begin with "event: "
      expect(lines[0]).toMatch(/^event: \S+/);
      // Must contain a "data: " line
      expect(lines.some((l) => l.startsWith('data: '))).toBe(true);
      // event type must match the type field in the JSON
      const eventType = lines[0].slice('event: '.length);
      const dataLine = lines.find((l) => l.startsWith('data: '))!;
      const parsed = JSON.parse(dataLine.slice('data: '.length)) as RestoreSseEvent;
      expect(parsed.type).toBe(eventType);
    }
  });
});
