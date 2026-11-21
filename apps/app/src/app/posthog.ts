import type { Properties } from 'posthog-js';
import type { PostHog } from 'posthog-node';

let posthogInstance: PostHog | null = null;

async function getPostHogClient(): Promise<PostHog | null> {
  if (posthogInstance) {
    return posthogInstance;
  }

  const apiKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const apiHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (apiKey && apiHost) {
    const { PostHog } = await import('posthog-node');
    posthogInstance = new PostHog(apiKey, {
      flushAt: 1,
      flushInterval: 0,
    });
    return posthogInstance;
  }

  return null;
}

export { getPostHogClient };

/**
 * AT-PATCH: is a feature-flag provider configured at all?
 *
 * Without PostHog, getFeatureFlags() returns {} and every flag reads as false.
 * That is indistinguishable from a provider that is present and has
 * deliberately turned a feature OFF, and the two need opposite defaults: an
 * explicit "off" should be honoured, but "no provider" must not silently
 * disable functionality the operator is running the software for.
 *
 * Self-hosted deployments never run PostHog, so gating on the flag alone hides
 * whole feature areas with no error and no setting to find.
 */
export function isFeatureFlagProviderConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY && process.env.NEXT_PUBLIC_POSTHOG_HOST);
}

export async function track(distinctId: string, eventName: string, properties?: Properties) {
  const client = await getPostHogClient();
  if (!client) return;

  client.capture({
    distinctId,
    event: eventName,
    properties,
  });
}

export async function identify(distinctId: string, properties?: Properties) {
  const client = await getPostHogClient();
  if (!client) return;

  client.identify({
    distinctId,
    properties,
  });
}

export async function getFeatureFlags(
  distinctId: string,
  options?: { groups?: Record<string, string> },
) {
  const client = await getPostHogClient();
  if (!client) return {};

  const flags = await client.getAllFlags(distinctId, {
    groups: options?.groups,
  });
  return flags;
}
