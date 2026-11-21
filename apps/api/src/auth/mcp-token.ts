import { requireMcpAuth } from '@better-auth/mcp';
import type { McpConfig } from './mcp-config';
import { parseAccessTokenAuthorization } from 'better-auth/oauth2';
import { decodeProtectedHeader } from 'jose';

type Auth = Parameters<typeof requireMcpAuth>[0];

export async function resolveMcpToken({
  auth,
  config,
  headers,
  method,
  path,
}: {
  auth: Auth;
  config: McpConfig | null;
  headers: Headers;
  method: string;
  path: string;
}): Promise<{ userId: string } | null> {
  if (!config) return null;
  try {
    const authorization = parseAccessTokenAuthorization(
      headers.get('authorization'),
    );
    if (
      !authorization ||
      decodeProtectedHeader(authorization.token).typ !== 'at+jwt'
    )
      return null;
  } catch {
    return null;
  }
  let identity: { userId: string } | null = null;
  const handler = requireMcpAuth(
    auth,
    async (_request, claims) => {
      if (
        typeof claims.sub !== 'string' ||
        claims.client_id !== config.clientId
      ) {
        return new Response(null, { status: 401 });
      }
      identity = { userId: claims.sub };
      return new Response(null, { status: 204 });
    },
    {
      issuer: config.issuer,
      resource: config.resource,
      requiredScopes: ['openid'],
    },
  );
  // The origin comes from trusted configuration, never forwarded request headers.
  const url = new URL(config.issuer);
  const incoming = new URL(path, url.origin);
  url.pathname = incoming.pathname;
  url.search = incoming.search;
  const response = await handler(new Request(url, { method, headers }));
  return response.status === 204 ? identity : null;
}
