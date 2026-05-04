import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildAuthorizeUrl, handleAuthorize, PHASE1_SCOPES } from './authorize.js';
import type { Request, Response } from 'express';

describe('PHASE1_SCOPES', () => {
  it('contains write:board-scope:jira-software', () => {
    expect(PHASE1_SCOPES).toContain('write:board-scope:jira-software');
  });

  it('contains write:board-scope.admin:jira-software', () => {
    expect(PHASE1_SCOPES).toContain('write:board-scope.admin:jira-software');
  });
});

describe('buildAuthorizeUrl — happy path', () => {
  const clientId = 'test-client-id';
  const redirectUri = 'http://localhost:3000/api/oauth/callback';
  const state = 'test-state-abc123';
  const codeChallenge = 'test-challenge-xyz';

  it('targets the Atlassian authorization endpoint', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    expect(url).toContain('https://auth.atlassian.com/authorize');
  });

  it('contains write:board-scope:jira-software in the scope parameter', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    expect(url).toContain('write%3Aboard-scope%3Ajira-software');
  });

  it('contains write:board-scope.admin:jira-software in the scope parameter', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    expect(url).toContain('write%3Aboard-scope.admin%3Ajira-software');
  });

  it('includes both board-scope variants (decoded URL check)', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('write:board-scope:jira-software');
    expect(decoded).toContain('write:board-scope.admin:jira-software');
  });

  it('includes PKCE code_challenge and S256 method', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain(`code_challenge=${codeChallenge}`);
  });

  it('includes the supplied state value', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    expect(url).toContain(`state=${state}`);
  });

  it('sets response_type=code', () => {
    const url = buildAuthorizeUrl(clientId, redirectUri, state, codeChallenge);
    expect(url).toContain('response_type=code');
  });
});

describe('handleAuthorize — error path', () => {
  let savedClientId: string | undefined;

  beforeEach(() => {
    savedClientId = process.env['ATLASSIAN_CLIENT_ID'];
    delete process.env['ATLASSIAN_CLIENT_ID'];
  });

  afterEach(() => {
    if (savedClientId !== undefined) {
      process.env['ATLASSIAN_CLIENT_ID'] = savedClientId;
    } else {
      delete process.env['ATLASSIAN_CLIENT_ID'];
    }
  });

  it('returns HTTP 500 when ATLASSIAN_CLIENT_ID is not configured', () => {
    const mockJson = vi.fn();
    const mockStatus = vi.fn().mockReturnValue({ json: mockJson });
    const req = {
      protocol: 'http',
      get: (_header: string) => 'localhost:3000',
    } as unknown as Request;
    const res = { status: mockStatus } as unknown as Response;

    handleAuthorize(req, res);

    expect(mockStatus).toHaveBeenCalledWith(500);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('ATLASSIAN_CLIENT_ID') })
    );
  });
});
