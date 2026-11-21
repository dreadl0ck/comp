import { afterAll, beforeAll, expect, test } from 'bun:test';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import {
  auth,
  authorization,
  config,
  db,
  exchange,
  hashMcpClientSecret,
  identity,
  readMcpConfig,
  request,
  resolveMcpToken,
  sessionId,
  sessionToken,
  setupFixture,
  teardownFixture,
  tokens,
  userId,
} from './helpers';

beforeAll(setupFixture);
afterAll(teardownFixture);

test('configuration is inert when absent and rejects partial or non-HTTPS remote configuration', () => {
  expect(readMcpConfig({})).toBeNull();
  expect(() => readMcpConfig({ GRAM_OAUTH_CLIENT_ID: 'partial' })).toThrow();
  expect(() =>
    readMcpConfig({
      ...process.env,
      MCP_RESOURCE_URL: 'http://remote.example.test',
    }),
  ).toThrow();
  expect(() =>
    readMcpConfig({
      ...process.env,
      GRAM_OAUTH_REDIRECT_URI: 'http://127.0.0.1/callback',
    }),
  ).toThrow();
});

test('trusted client is idempotent, hashed, PKCE-required and linked to exactly its resource', async () => {
  const client = await db.mcpOAuthClient.findUniqueOrThrow({
    where: { clientId: config.clientId },
  });
  expect(client.clientSecret).toBe(hashMcpClientSecret(config.clientSecret));
  expect(client.clientSecret).not.toBe(config.clientSecret);
  expect(client.requirePKCE).toBe(true);
  expect(client.grantTypes).toEqual(['authorization_code', 'refresh_token']);
  expect(
    await db.mcpOAuthClientResource.count({
      where: { clientId: config.clientId, resourceId: config.resource },
    }),
  ).toBe(1);
  expect(
    await db.oauthApplication.count({ where: { clientId: 'legacy-fixture' } }),
  ).toBe(1);
});

test('discovery advertises modern endpoints and no registration; legacy registration remains closed', async () => {
  const response = await request(
    '/api/auth/.well-known/oauth-authorization-server',
  );
  expect(response.status).toBe(200);
  const metadata = await response.json();
  expect(metadata.authorization_endpoint).toBe(
    config.issuer + '/oauth2/authorize',
  );
  expect(metadata.token_endpoint).toBe(config.issuer + '/oauth2/token');
  expect(metadata.registration_endpoint).toBeUndefined();
  expect(
    (await request('/.well-known/oauth-authorization-server/api/auth')).status,
  ).toBe(200);
  expect((await request('/.well-known/oauth-protected-resource')).status).toBe(
    200,
  );
  expect(
    (await request('/api/auth/mcp/register', new URLSearchParams())).status,
  ).not.toBe(200);
  expect(
    (
      await request('/api/auth/token', undefined, {
        authorization: `Bearer ${sessionToken}`,
      })
    ).status,
  ).toBe(404);
});

test('real authorization-code/PKCE flow produces a resource-bound token that resolves its user', async () => {
  const result = await tokens();
  expect(decodeProtectedHeader(result.access_token).typ).toBe('at+jwt');
  const claims = decodeJwt(result.access_token);
  expect(claims.iss).toBe(config.issuer);
  expect([claims.aud].flat()).toContain(config.resource);
  expect(claims.client_id).toBe(config.clientId);
  expect(claims.sub).toBe(userId);
  expect(await identity(result.access_token)).toEqual({ userId });
  expect(await identity(result.id_token)).toBeNull();
  expect(await identity(sessionToken)).toBeNull();
});

test('bad verifier and bad client secret cannot consume a valid code; successful code cannot be replayed', async () => {
  const { code, verifier } = await authorization();
  expect((await exchange(code, 'x'.repeat(64))).status).toBe(400);
  expect((await exchange(code, verifier, 'wrong-secret')).status).toBe(400);
  expect((await exchange(code, verifier)).status).toBe(200);
  expect((await exchange(code, verifier)).status).toBe(400);
});

test('signature, issuer, audience and registered client are enforced independently', async () => {
  const { access_token } = await tokens();
  const [header, payload] = access_token.split('.');
  expect(await identity(`${header}.${payload}.${'A'.repeat(86)}`)).toBeNull();
  const input = {
    auth,
    headers: new Headers({ authorization: `Bearer ${access_token}` }),
    method: 'GET',
    path: '/v1/mcp/organization',
  };
  for (const invalid of [
    { resource: 'https://other.example.test' },
    { issuer: 'https://issuer.example.test/api/auth' },
    { clientId: 'foreign-client' },
  ]) {
    expect(
      await resolveMcpToken({ ...input, config: { ...config, ...invalid } }),
    ).toBeNull();
  }
});

test('refresh tokens are hashed and rotate without a replay allowance', async () => {
  const initial = await tokens();
  const refresh = (token: string) =>
    request(
      '/api/auth/oauth2/token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        resource: config.resource,
      }),
    );
  const response = await refresh(initial.refresh_token);
  const rotated = await response.json();
  expect(response.status).toBe(200);
  expect(rotated.refresh_token).not.toBe(initial.refresh_token);
  expect(await identity(rotated.access_token)).toEqual({ userId });
  expect(
    await db.mcpOAuthRefreshToken.count({
      where: { token: initial.refresh_token },
    }),
  ).toBe(0);
  expect((await refresh(initial.refresh_token)).status).toBe(400);
});

test('an expired session cannot authorize new tokens', async () => {
  await db.session.update({
    where: { id: sessionId },
    data: { expiresAt: new Date(0) },
  });
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    scope: 'openid',
    resource: config.resource,
    code_challenge: 'x'.repeat(43),
    code_challenge_method: 'S256',
  });
  const response = await request(
    '/api/auth/oauth2/authorize?' + query,
    undefined,
    { authorization: `Bearer ${sessionToken}` },
  );
  expect(response.status).toBe(302);
  expect(response.headers.get('location')).toStartWith(config.loginPage);
});
