import { db } from '@db';
import { Redis } from '@upstash/redis';
import { isStaticTrustedOrigin } from './origin-policy';
import {
  resolveMicrosoftEmail,
  type MicrosoftEmailClaims,
} from './microsoft-email';

export function getCookieDomain(): string | undefined {
  const baseUrl = process.env.BASE_URL || '';
  if (baseUrl.includes('staging.trycomp.ai')) return '.staging.trycomp.ai';
  if (baseUrl.includes('trycomp.ai')) return '.trycomp.ai';
  return undefined;
}

const corsRedisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
const REDIS_CONFIGURED = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);
const CORS_DOMAINS_CACHE_KEY = 'cors:custom-domains';
const CORS_DOMAINS_CACHE_TTL_SECONDS = 5 * 60;

async function getCustomDomains(): Promise<Set<string>> {
  // An unconfigured Upstash client otherwise retries on every Origin-bearing request.
  if (REDIS_CONFIGURED) {
    try {
      const cached = await corsRedisClient.get<string[]>(
        CORS_DOMAINS_CACHE_KEY,
      );
      if (cached) return new Set(cached);
    } catch (error) {
      console.error(
        '[CORS] Redis cache read failed, falling back to DB:',
        error,
      );
    }
  }
  try {
    const trusts = await db.trust.findMany({
      where: {
        domain: { not: null },
        domainVerified: true,
        status: 'published',
      },
      select: { domain: true },
    });
    const domains = trusts
      .map((t) => t.domain)
      .filter((d): d is string => d !== null);
    if (REDIS_CONFIGURED) {
      try {
        await corsRedisClient.set(CORS_DOMAINS_CACHE_KEY, domains, {
          ex: CORS_DOMAINS_CACHE_TTL_SECONDS,
        });
      } catch {
        // Redis cache writes are best-effort; the verified DB result remains authoritative.
      }
    }
    return new Set(domains);
  } catch (error) {
    console.error('[CORS] Failed to fetch custom domains from DB:', error);
    return new Set();
  }
}

export async function isTrustedOrigin(origin: string): Promise<boolean> {
  if (isStaticTrustedOrigin(origin)) return true;
  try {
    return (await getCustomDomains()).has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export const socialProviders: Record<string, unknown> = {};
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  socialProviders.google = {
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  };
}
if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  socialProviders.github = {
    clientId: process.env.AUTH_GITHUB_ID,
    clientSecret: process.env.AUTH_GITHUB_SECRET,
  };
}
if (
  process.env.AUTH_MICROSOFT_CLIENT_ID &&
  process.env.AUTH_MICROSOFT_CLIENT_SECRET
) {
  socialProviders.microsoft = {
    clientId: process.env.AUTH_MICROSOFT_CLIENT_ID,
    clientSecret: process.env.AUTH_MICROSOFT_CLIENT_SECRET,
    tenantId: process.env.AUTH_MICROSOFT_TENANT_ID || 'common',
    prompt: 'select_account',
    mapProfileToUser: (profile: MicrosoftEmailClaims) => ({
      email: resolveMicrosoftEmail(profile),
    }),
  };
}

export function validateSecurityConfig(): void {
  if (!process.env.SECRET_KEY) {
    throw new Error(
      'SECURITY ERROR: SECRET_KEY environment variable is required. Generate a secure secret with: openssl rand -base64 32',
    );
  }
  if (process.env.SECRET_KEY.length < 16) {
    throw new Error(
      'SECURITY ERROR: SECRET_KEY must be at least 16 characters long for security.',
    );
  }
  if (
    process.env.NODE_ENV === 'production' &&
    (process.env.BASE_URL || '').includes('localhost')
  ) {
    console.warn(
      'SECURITY WARNING: BASE_URL contains "localhost" in production. This may cause issues with OAuth callbacks and cookies.',
    );
  }
}
