import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiKeyService } from '../auth/api-key.service';
import { HybridAuthGuard } from '../auth/hybrid-auth.guard';
import { SourceController } from './source.controller';

const getSession = jest.fn();
jest.mock('../auth/auth.server', () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSession(...args),
      getMcpSession: async () => null,
    },
  },
}));
jest.mock('@db', () => ({ db: {} }));
jest.mock('@trycompai/auth', () => ({ BUILT_IN_ROLE_PERMISSIONS: {} }));

describe('matching-source authentication', () => {
  const apiKeyService = { extractApiKey: jest.fn(), validateApiKey: jest.fn() };
  let guard: HybridAuthGuard;
  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        HybridAuthGuard,
        Reflector,
        { provide: ApiKeyService, useValue: apiKeyService },
      ],
    }).compile();
    guard = module.get(HybridAuthGuard);
  });
  const context = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      getHandler: () => SourceController.prototype.metadata,
      getClass: () => SourceController,
    }) as unknown as ExecutionContext;

  it.each(['employee', 'contractor', 'auditor', 'admin'])(
    'allows a valid %s session without an active org or source-specific role',
    async (role) => {
      getSession.mockResolvedValue({
        user: { id: 'fixture-user', email: 'fixture@example.test', role },
        session: { id: 'fixture-session', activeOrganizationId: null },
      });
      await expect(
        guard.canActivate(context({ cookie: 'synthetic-session' })),
      ).resolves.toBe(true);
    },
  );
  it('allows an existing valid read-only API key without adding a scope', async () => {
    apiKeyService.extractApiKey.mockReturnValue('synthetic-key');
    apiKeyService.validateApiKey.mockResolvedValue({
      organizationId: 'fixture-org',
      scopes: ['control:read'],
      apiKeyId: 'fixture-key',
    });
    await expect(
      guard.canActivate(context({ 'x-api-key': 'synthetic-key' })),
    ).resolves.toBe(true);
  });
  it('preserves denial for unauthenticated callers', async () => {
    await expect(guard.canActivate(context({}))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
