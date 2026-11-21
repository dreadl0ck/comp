import { createHash } from 'node:crypto';
import { mcp } from '@better-auth/mcp';
import { jwt } from 'better-auth/plugins';

export const MCP_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export interface McpConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  resource: string;
  issuer: string;
  loginPage: string;
}

function validateUrl(value: string): string {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'MCP configuration requires HTTPS URLs without credentials, query or fragment',
    );
  return value;
}

export function readMcpConfig(env: NodeJS.ProcessEnv): McpConfig | null {
  const keys = [
    'GRAM_OAUTH_CLIENT_ID',
    'GRAM_OAUTH_CLIENT_SECRET',
    'GRAM_OAUTH_REDIRECT_URI',
    'MCP_RESOURCE_URL',
  ] as const;
  if (!keys.some((key) => env[key])) return null;
  if (keys.some((key) => !env[key]))
    throw new Error(
      'Hosted MCP requires all GRAM_OAUTH_* credentials and MCP_RESOURCE_URL',
    );
  const base = validateUrl(env.BASE_URL || 'http://localhost:3333').replace(
    /\/$/,
    '',
  );
  const redirectUri = validateUrl(env.GRAM_OAUTH_REDIRECT_URI!);
  if (new URL(redirectUri).protocol !== 'https:')
    throw new Error('Gram web-client redirect URI must use HTTPS');
  return {
    clientId: env.GRAM_OAUTH_CLIENT_ID!,
    clientSecret: env.GRAM_OAUTH_CLIENT_SECRET!,
    redirectUri,
    resource: validateUrl(env.MCP_RESOURCE_URL!),
    issuer: base + '/api/auth',
    loginPage: validateUrl(
      env.MCP_OAUTH_LOGIN_PAGE ||
        `${env.NEXT_PUBLIC_APP_URL || 'https://app.trycomp.ai'}/auth`,
    ),
  };
}

export const hashMcpClientSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

export function mcpPlugins(config: McpConfig | null) {
  if (!config) return [];
  return [
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      resource: config.resource,
      loginPage: config.loginPage,
      consentPage: config.loginPage,
      scopes: MCP_SCOPES,
      grantTypes: ['authorization_code', 'refresh_token'],
      allowDynamicClientRegistration: false,
      allowUnauthenticatedClientRegistration: false,
      clientPrivileges: async () => false,
      resourcePrivileges: async () => false,
      refreshTokenReuseInterval: 0,
      accessTokenExpiresIn: 900,
      storeClientSecret: { hash: hashMcpClientSecret },
      resources: [
        {
          identifier: config.resource,
          name: 'Comp AI MCP',
          allowedScopes: MCP_SCOPES,
        },
      ],
      schema: {
        oauthClient: { modelName: 'McpOAuthClient' },
        oauthResource: { modelName: 'McpOAuthResource' },
        oauthClientResource: { modelName: 'McpOAuthClientResource' },
        oauthAccessToken: { modelName: 'McpOAuthAccessToken' },
        oauthRefreshToken: { modelName: 'McpOAuthRefreshToken' },
        oauthConsent: { modelName: 'McpOAuthConsent' },
        oauthClientAssertion: { modelName: 'McpOAuthClientAssertion' },
      },
    }),
  ];
}
