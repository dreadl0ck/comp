import { expect, mock } from 'bun:test';
import { createHash, randomBytes } from 'node:crypto';
import { render } from '@react-email/render';
import type { ReactElement } from 'react';
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from 'express';

if (!process.env.DATABASE_URL?.includes('@127.0.0.1:5432/comp_mcp_fixture')) {
  throw new Error(
    'MCP tests require the owned network-isolated Postgres fixture',
  );
}
process.env.BASE_URL = 'http://127.0.0.1:3333';
process.env.AUTH_TRUSTED_ORIGINS = process.env.BASE_URL;
if (!process.env.MCP_FIXTURE_AUTH_SECRET)
  throw new Error('Owned fixture signing secret is required');
process.env.SECRET_KEY = process.env.MCP_FIXTURE_AUTH_SECRET;
process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('hex');
process.env.GRAM_OAUTH_CLIENT_ID = 'owned-gram-fixture';
process.env.GRAM_OAUTH_CLIENT_SECRET = randomBytes(32).toString('hex');
process.env.GRAM_OAUTH_REDIRECT_URI = 'https://gram.example.test/callback';
process.env.MCP_RESOURCE_URL = 'https://mcp.example.test/comp';
process.env.MCP_OAUTH_LOGIN_PAGE = 'http://127.0.0.1:3333/auth';
mock.module('../../src/config/load-env', () => ({ ensureEnvLoaded() {} }));
export const mail: { to: string; html: string }[] = [];
mock.module('../../src/email/trigger-email', () => ({
  triggerEmail: async ({ to, react }: { to: string; react: ReactElement }) => {
    if (!to.endsWith('@example.test'))
      throw new Error('Non-fixture mail recipient');
    mail.push({ to, html: await render(react) });
    return { id: 'owned-fixture-mail' };
  },
}));
globalThis.fetch = (() => {
  throw new Error('Unexpected outbound fetch');
}) as typeof fetch;
export const { auth, mcpConfig, getMcpSession } =
  await import('../../src/auth/auth.server');
const { seedMcpClient } = await import('../../src/auth/mcp-client');
export const { resolveMcpToken } = await import('../../src/auth/mcp-token');
export const { readMcpConfig, hashMcpClientSecret } =
  await import('../../src/auth/mcp-config');
const { legacyMcpRoutes } = await import('../../src/auth/mcp-routes');
export const { db } = await import('../../prisma');
if (!mcpConfig) throw new Error('Fixture provider must be enabled');
export const config = mcpConfig;
export const sessionToken = randomBytes(32).toString('hex');
export let userId: string;
export let sessionId: string;

export function request(
  path: string,
  body?: URLSearchParams,
  headers: HeadersInit = {},
) {
  const req = { url: path, originalUrl: path } as ExpressRequest;
  legacyMcpRoutes(req, {} as ExpressResponse, () => {});
  return auth.handler(
    new Request(config.issuer.replace('/api/auth', '') + req.url, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body
          ? { 'content-type': 'application/x-www-form-urlencoded' }
          : {}),
        ...headers,
      },
      body,
    }),
  );
}

export async function authorization() {
  const verifier = randomBytes(48).toString('base64url');
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'openid profile email offline_access',
    resource: config.resource,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: randomBytes(16).toString('hex'),
  });
  const response = await request(
    '/api/auth/mcp/authorize?' + query,
    undefined,
    { authorization: `Bearer ${sessionToken}` },
  );
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get('location')!);
  expect(callback.origin + callback.pathname).toBe(config.redirectUri);
  expect(callback.searchParams.get('state')).toBe(query.get('state'));
  const code = callback.searchParams.get('code');
  if (!code)
    throw new Error(
      'Expected authorization code: ' + callback.searchParams.get('error'),
    );
  return { code, verifier };
}

export function exchange(
  code: string,
  verifier: string,
  secret = config.clientSecret,
) {
  return request(
    '/api/auth/mcp/token',
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: config.clientId,
      client_secret: secret,
      redirect_uri: config.redirectUri,
      resource: config.resource,
    }),
  );
}

export async function tokens() {
  const { code, verifier } = await authorization();
  const response = await exchange(code, verifier);
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(typeof result.access_token).toBe('string');
  return result as {
    access_token: string;
    refresh_token: string;
    id_token: string;
  };
}

export function identity(token: string) {
  return getMcpSession({
    headers: new Headers({ authorization: `Bearer ${token}` }),
    method: 'GET',
    path: '/v1/mcp/organization',
  });
}

export async function setupFixture() {
  await seedMcpClient(config);
  await seedMcpClient(config);
  await auth.$context;
  const user = await db.user.upsert({
    where: { email: 'mcp@example.test' },
    create: {
      name: 'Owned fixture',
      email: 'mcp@example.test',
      emailVerified: true,
    },
    update: {},
  });
  userId = user.id;
  const session = await db.session.create({
    data: {
      userId,
      token: sessionToken,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  sessionId = session.id;
  expect(
    (
      await auth.api.getSession({
        headers: new Headers({ authorization: `Bearer ${sessionToken}` }),
      })
    )?.user.id,
  ).toBe(userId);
}

export async function teardownFixture() {
  await db.$disconnect();
}
