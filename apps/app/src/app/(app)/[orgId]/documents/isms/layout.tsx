import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getFeatureFlags, isFeatureFlagProviderConfigured } from '@/app/posthog';
import { serverApi } from '@/lib/api-server';
import { auth } from '@/utils/auth';
import { ISO27001_NAMES } from './isms-types';

interface FrameworkApiResponse {
  data: Array<{ id: string; frameworkId: string; framework: { id: string; name: string } }>;
}

/**
 * PostHog flag gating the ISMS area while it's privately tested. Mirrors
 * `ISMS_FEATURE_FLAG` in DocumentsPageTabs so the routes and the tab stay in
 * lockstep.
 */
const ISMS_FEATURE_FLAG = 'is-isms-enabled';

/**
 * Server-side gate for every `/[orgId]/documents/isms/*` route (wizard +
 * detail pages). The ISMS tab in DocumentsPageTabs is hidden behind the
 * `is-isms-enabled` PostHog flag, but the routes themselves were reachable by
 * direct URL during private testing. This layout enforces the same gate:
 *  - the flag must be enabled for the org (boolean or string "true"), and
 *  - the ISO 27001 framework must be active.
 * Development falls through on the flag check so the area stays visible locally
 * without PostHog configured — identical to DocumentsPageTabs.
 */
export default async function IsmsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect(`/${orgId}/documents`);
  const organizationId = session.session.activeOrganizationId ?? orgId;

  const flags = await getFeatureFlags(session.user.id, {
    groups: { organization: organizationId },
  });
  const ismsFlagEnabled =
    flags[ISMS_FEATURE_FLAG] === true || flags[ISMS_FEATURE_FLAG] === 'true';
  // AT-PATCH: also fall through when no flag provider is configured at all.
  //
  // Upstream falls through only for NODE_ENV === 'development', so a
  // self-hosted PRODUCTION deployment -- which never runs PostHog -- got
  // flags = {}, read the flag as false, and redirected every ISMS route to
  // /documents. The entire ISO 27001 Clause 4-10 area was therefore
  // unreachable, with no error, no empty state and no setting to find: the
  // documents existed and were correctly populated via the API, and the UI
  // simply bounced you to a different page.
  //
  // "Provider absent" and "provider says off" must not collapse to the same
  // default. An explicit false is still honoured below when PostHog IS
  // configured, so SaaS behaviour is unchanged.
  const flagAllowsIsms =
    ismsFlagEnabled ||
    !isFeatureFlagProviderConfigured() ||
    process.env.NODE_ENV === 'development';

  if (!flagAllowsIsms) redirect(`/${orgId}/documents`);

  // The ISMS area is meaningless without ISO 27001 active — match the same
  // requirement DocumentsPageTabs enforces before showing the tab.
  const frameworksResult = await serverApi.get<FrameworkApiResponse>('/v1/frameworks');
  const frameworks = frameworksResult.data?.data ?? [];
  const hasIso27001 = frameworks.some(
    (instance) => instance.framework?.name && ISO27001_NAMES.includes(instance.framework.name),
  );

  if (!hasIso27001) redirect(`/${orgId}/documents`);

  return <>{children}</>;
}
