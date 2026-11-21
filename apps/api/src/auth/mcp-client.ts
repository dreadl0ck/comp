import { Injectable, OnModuleInit } from '@nestjs/common';
import { db } from '@db';
import { auth, mcpConfig } from './auth.server';
import { hashMcpClientSecret, MCP_SCOPES, type McpConfig } from './mcp-config';

export async function seedMcpClient(config: McpConfig | null): Promise<void> {
  if (!config) return;
  await db.$transaction(async (tx) => {
    const client = {
      clientSecret: hashMcpClientSecret(config.clientSecret),
      name: 'Comp AI MCP (Gram)',
      redirectUris: [config.redirectUri],
      scopes: MCP_SCOPES,
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'client_secret_post',
      applicationType: 'web',
      requirePKCE: true,
      skipConsent: true,
      disabled: false,
    };
    await tx.mcpOAuthClient.upsert({
      where: { clientId: config.clientId },
      create: { clientId: config.clientId, ...client },
      update: client,
    });
    await tx.mcpOAuthResource.upsert({
      where: { identifier: config.resource },
      create: {
        identifier: config.resource,
        name: 'Comp AI MCP',
        allowedScopes: MCP_SCOPES,
      },
      update: { allowedScopes: MCP_SCOPES },
    });
    await tx.mcpOAuthClientResource.upsert({
      where: {
        clientId_resourceId: {
          clientId: config.clientId,
          resourceId: config.resource,
        },
      },
      create: { clientId: config.clientId, resourceId: config.resource },
      update: {},
    });
  });
}

@Injectable()
export class McpClientInitializer implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await seedMcpClient(mcpConfig);
    await auth.$context;
  }
}
