import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `redirect` throws in Next.js to halt rendering; model that with a sentinel so
// we can assert the destination and stop execution like the real runtime does.
class RedirectError extends Error {
  constructor(public readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}
const mockRedirect = vi.fn((to: string) => {
  throw new RedirectError(to);
});
vi.mock('next/navigation', () => ({
  redirect: (to: string) => mockRedirect(to),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('@/utils/auth', async () => {
  const { mockAuth } = await import('@/test-utils/mocks/auth');
  return { auth: mockAuth };
});

const mockGetFeatureFlags = vi.fn();
vi.mock('@/app/posthog', () => ({
  getFeatureFlags: (...args: unknown[]) => mockGetFeatureFlags(...args),
}));

const mockServerApiGet = vi.fn();
vi.mock('@/lib/api-server', () => ({
  serverApi: { get: (...args: unknown[]) => mockServerApiGet(...args) },
}));

import { createMockSession, createMockUser, setupAuthMocks } from '@/test-utils/mocks/auth';

const { default: IsmsLayout } = await import('./layout');

const ORG_ID = 'org_test123';
const children = 'ISMS content';

const renderLayout = () =>
  IsmsLayout({ children, params: Promise.resolve({ orgId: ORG_ID }) });

const isoFrameworksResponse = {
  data: {
    data: [{ id: 'fi-1', frameworkId: 'fr-iso', framework: { id: 'fr-iso', name: 'ISO 27001' } }],
  },
};

describe('IsmsLayout gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    setupAuthMocks({
      session: createMockSession({ activeOrganizationId: ORG_ID }),
      user: createMockUser({ id: 'user_test123' }),
    });
    mockGetFeatureFlags.mockResolvedValue({ 'is-isms-enabled': true });
    mockServerApiGet.mockResolvedValue(isoFrameworksResponse);
    // AT-PATCH: the gate now distinguishes "provider says off" from "no
    // provider configured", so the flag cases must run with a provider
    // present. Without this every flag assertion below would pass for the
    // wrong reason -- via the no-provider fall-through rather than the flag.
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://posthog.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders children when the flag is enabled and ISO 27001 is active', async () => {
    const result = await renderLayout();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(mockGetFeatureFlags).toHaveBeenCalledWith('user_test123', {
      groups: { organization: ORG_ID },
    });
    expect(result.props.children).toBe(children);
  });

  it('treats the string "true" flag value as enabled', async () => {
    mockGetFeatureFlags.mockResolvedValue({ 'is-isms-enabled': 'true' });
    await expect(renderLayout()).resolves.toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to documents when the flag is off (outside development)', async () => {
    mockGetFeatureFlags.mockResolvedValue({ 'is-isms-enabled': false });
    await expect(renderLayout()).rejects.toThrow(`REDIRECT:/${ORG_ID}/documents`);
    expect(mockRedirect).toHaveBeenCalledWith(`/${ORG_ID}/documents`);
    // Framework lookup is short-circuited once the flag gate fails.
    expect(mockServerApiGet).not.toHaveBeenCalled();
  });

  it('falls through the flag check in development without PostHog', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    mockGetFeatureFlags.mockResolvedValue({});
    await expect(renderLayout()).resolves.toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // AT-PATCH: the self-hosting case. A production deployment with no PostHog
  // got flags = {}, read the flag as false and redirected every ISMS route to
  // /documents -- hiding the whole ISO 27001 area with no error and no setting
  // to find. "No provider" must not mean "feature off".
  it('falls through in production when no flag provider is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '');
    mockGetFeatureFlags.mockResolvedValue({});
    await expect(renderLayout()).resolves.toBeTruthy();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // The other half of the distinction: with a provider present, an explicit
  // false is still honoured, so SaaS behaviour is unchanged.
  it('still redirects in production when a provider is configured and says off', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mockGetFeatureFlags.mockResolvedValue({ 'is-isms-enabled': false });
    await expect(renderLayout()).rejects.toThrow(`REDIRECT:/${ORG_ID}/documents`);
    expect(mockRedirect).toHaveBeenCalledWith(`/${ORG_ID}/documents`);
  });

  it('redirects when ISO 27001 is not active even if the flag is enabled', async () => {
    mockServerApiGet.mockResolvedValue({ data: { data: [] } });
    await expect(renderLayout()).rejects.toThrow(`REDIRECT:/${ORG_ID}/documents`);
    expect(mockRedirect).toHaveBeenCalledWith(`/${ORG_ID}/documents`);
  });

  it('redirects when there is no session', async () => {
    setupAuthMocks({ session: null, user: null });
    await expect(renderLayout()).rejects.toThrow(`REDIRECT:/${ORG_ID}/documents`);
    expect(mockGetFeatureFlags).not.toHaveBeenCalled();
  });
});
