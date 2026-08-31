import '../config/load-env';
import {
  ChangeEmailConfirmationEmail,
  MagicLinkEmail,
  OTPVerificationEmail,
  VerifyEmail,
} from '@trycompai/email';
import { triggerEmail } from '../email/trigger-email';
import { InviteEmail } from '../email/templates/invite-member';
import { db } from '@db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import {
  admin,
  bearer,
  emailOTP,
  magicLink,
  mcp,
  multiSession,
  organization,
} from 'better-auth/plugins';
import { ac, allRoles } from '@trycompai/auth';
import { createAuthMiddleware } from 'better-auth/api';
import { Redis } from '@upstash/redis';
import type { AccessControl } from 'better-auth/plugins/access';
import {
  resolveMicrosoftEmail,
  type MicrosoftEmailClaims,
} from './microsoft-email';
import {
  getBetterAuthTrustedOrigins,
  isStaticTrustedOrigin,
} from './origin-policy';

export {
  getBetterAuthTrustedOrigins,
  getCompExtensionTrustedOrigins,
  getTrustedOrigins,
  isChromeExtensionOrigin,
  isCompExtensionAllowedRoute,
  isCompExtensionOrigin,
  isCompExtensionOriginAllowedForRequest,
  isStaticTrustedOrigin,
  isStaticTrustedOriginForRequest,
} from './origin-policy';

const MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 60; // 1 hour

/**
 * Determine the cookie domain based on environment.
 */
function getCookieDomain(): string | undefined {
  const baseUrl = process.env.BASE_URL || '';

  if (baseUrl.includes('staging.trycomp.ai')) {
    return '.staging.trycomp.ai';
  }
  if (baseUrl.includes('trycomp.ai')) {
    return '.trycomp.ai';
  }
  return undefined;
}

// ── Custom domain lookup via Redis cache ─────────────────────────────────────

const CORS_DOMAINS_CACHE_KEY = 'cors:custom-domains';
const CORS_DOMAINS_CACHE_TTL_SECONDS = 5 * 60; // 5 minutes

const corsRedisClient = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// AT-PATCH: skip the cache entirely when Upstash is not configured.
//
// getCustomDomains() runs on EVERY request that carries an Origin header, via
// isTrustedOrigin() in the CORS middleware. With UPSTASH_REDIS_REST_URL unset
// the client is still constructed and still issues commands, and @upstash/redis
// retries with exponential backoff before giving up -- roughly 4.3s. The
// function makes two round trips (a get, then a set after the DB fallback), so
// each such request paid about 8.6 seconds.
//
// Every server-rendered page hits this, because apps/app's headersToObject
// substitutes `origin: API_URL` when the browser sends none. The result was a
// hard ~8.8s on every single page while each endpoint measured ~2ms without an
// Origin header. Falling straight through to the DB makes it ~2ms.
const REDIS_CONFIGURED = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

async function getCustomDomains(): Promise<Set<string>> {
  // Try Redis cache first (non-fatal if Redis is unavailable)
  if (REDIS_CONFIGURED) {
    try {
      const cached = await corsRedisClient.get<string[]>(CORS_DOMAINS_CACHE_KEY);
      if (cached) {
        return new Set(cached);
      }
    } catch (error) {
      console.error('[CORS] Redis cache read failed, falling back to DB:', error);
    }
  }

  // Cache miss or Redis unavailable — query DB
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

    // Best-effort cache update (don't lose DB results if Redis SET fails).
    // AT-PATCH: guarded — this is the second of the two retry cycles that made
    // every Origin-bearing request cost ~8.6s when Upstash is unconfigured.
    if (REDIS_CONFIGURED) {
      try {
        await corsRedisClient.set(CORS_DOMAINS_CACHE_KEY, domains, {
          ex: CORS_DOMAINS_CACHE_TTL_SECONDS,
        });
      } catch {
        // Redis unavailable — continue without caching
      }
    }

    return new Set(domains);
  } catch (error) {
    console.error('[CORS] Failed to fetch custom domains from DB:', error);
    return new Set();
  }
}

/**
 * Check if an origin is trusted. Checks (in order):
 * 1. Static trusted origins list
 * 2. *.trycomp.ai / *.trust.inc subdomains
 * 3. Published custom domains from the DB (cached in Redis, TTL 5 min)
 */
export async function isTrustedOrigin(origin: string): Promise<boolean> {
  if (isStaticTrustedOrigin(origin)) {
    return true;
  }

  // Check verified custom domains from DB via Redis cache
  try {
    const url = new URL(origin);
    const customDomains = await getCustomDomains();
    return customDomains.has(url.hostname);
  } catch {
    return false;
  }
}

// Build social providers config
const socialProviders: Record<string, unknown> = {};

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
    // Microsoft Entra often omits the `email` claim for work/school accounts,
    // which makes better-auth abort sign-in with `email_not_found`. Fall back to
    // the username/UPN claims so these users can sign in. Accounts that DO return
    // an `email` claim are unaffected. See ./microsoft-email.ts.
    mapProfileToUser: (profile: MicrosoftEmailClaims) => ({
      email: resolveMicrosoftEmail(profile),
    }),
  };
}

const cookieDomain = getCookieDomain();

// ── Hosted MCP (Speakeasy Gram) OAuth ────────────────────────────────────────
// The MCP server is hosted on Gram. Gram obtains an OAuth access token from this
// API (better-auth as the authorization server) so users authenticate with
// "Sign in with Google" instead of pasting an API key.
//
// Gram's OAuth Proxy registers as a single static client and handles Dynamic
// Client Registration toward MCP clients on our behalf — so we keep public DCR
// off for now and register Gram as a trusted client. Configured via env so the
// secret isn't committed and the plugin is inert in envs where hosted MCP isn't
// set up yet.
const gramMcpClient =
  process.env.GRAM_OAUTH_CLIENT_ID &&
  process.env.GRAM_OAUTH_CLIENT_SECRET &&
  process.env.GRAM_OAUTH_REDIRECT_URI
    ? {
        clientId: process.env.GRAM_OAUTH_CLIENT_ID,
        clientSecret: process.env.GRAM_OAUTH_CLIENT_SECRET,
        name: 'Comp AI MCP (Gram)',
        type: 'web' as const,
        disabled: false,
        redirectUrls: [process.env.GRAM_OAUTH_REDIRECT_URI],
        metadata: null,
        // First-party client: Gram is Comp AI's own hosted MCP, so the user's
        // login (Sign in with Google) IS the authorization — no separate consent
        // screen is needed. This also avoids having to build a consent page UI.
        skipConsent: true,
      }
    : null;

// Where better-auth sends the user to authenticate during the OAuth flow.
// Must point at the app's sign-in page. Override per environment via env.
const mcpLoginPage =
  process.env.MCP_OAUTH_LOGIN_PAGE ||
  `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.trycomp.ai'}/auth`;

// =============================================================================
// Security Validation
// =============================================================================

/**
 * Validate required environment variables at startup.
 * Throws an error if critical security configuration is missing.
 */
function validateSecurityConfig(): void {
  if (!process.env.SECRET_KEY) {
    throw new Error(
      'SECURITY ERROR: SECRET_KEY environment variable is required. ' +
        'Generate a secure secret with: openssl rand -base64 32',
    );
  }

  if (process.env.SECRET_KEY.length < 16) {
    throw new Error(
      'SECURITY ERROR: SECRET_KEY must be at least 16 characters long for security.',
    );
  }

  // Warn about development defaults in production
  if (process.env.NODE_ENV === 'production') {
    const baseUrl = process.env.BASE_URL || '';
    if (baseUrl.includes('localhost')) {
      console.warn(
        'SECURITY WARNING: BASE_URL contains "localhost" in production. ' +
          'This may cause issues with OAuth callbacks and cookies.',
      );
    }
  }
}

// Run validation at module load time
validateSecurityConfig();

/**
 * The auth server instance - single source of truth for authentication.
 *
 * BASE_URL must point to the API (e.g., https://api.trycomp.ai).
 * OAuth callbacks go directly to the API. Clients send absolute callbackURLs
 * so better-auth redirects to the correct app after processing.
 * Cross-subdomain cookies (.trycomp.ai) ensure the session works on all apps.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: 'postgresql',
  }),
  // baseURL must point to the API (e.g., https://api.trycomp.ai) so that
  // OAuth callbacks go directly to the API regardless of which frontend
  // initiated the flow. Clients must send absolute callbackURLs so that
  // after OAuth processing, better-auth redirects to the correct app.
  // Cross-subdomain cookies (.trycomp.ai) ensure the session works everywhere.
  baseURL: process.env.BASE_URL || 'http://localhost:3333',
  trustedOrigins: getBetterAuthTrustedOrigins(),
  emailAndPassword: {
    // Not used — apps sign in via magic link, email OTP, and OAuth.
    enabled: false,
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.NODE_ENV === 'development') {
        console.log('[Auth] Sending verification email to:', user.email);
      }
      await triggerEmail({
        to: user.email,
        subject: 'Verify your email for Comp AI',
        react: VerifyEmail({ email: user.email, url }),
      });
    },
  },
  advanced: {
    database: {
      generateId: false,
    },
    // Prevent cookie collisions between environments.
    // Production keeps the default 'better-auth' prefix (unchanged).
    ...(cookieDomain === '.staging.trycomp.ai' && {
      cookiePrefix: 'staging',
    }),
    ...(!cookieDomain && {
      cookiePrefix: 'local',
    }),
    ...(cookieDomain && {
      crossSubDomainCookies: {
        enabled: true,
        domain: cookieDomain,
      },
      defaultCookieAttributes: {
        sameSite: 'lax' as const,
        secure: true,
      },
    }),
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const isDev = process.env.NODE_ENV === 'development';
          if (isDev) {
            console.log(
              '[Better Auth] Session creation hook called for user:',
              session.userId,
            );
          }
          try {
            const userOrganization = await db.organization.findFirst({
              where: {
                members: {
                  some: {
                    userId: session.userId,
                  },
                },
              },
              orderBy: {
                createdAt: 'desc',
              },
              select: {
                id: true,
                name: true,
              },
            });

            if (userOrganization) {
              if (isDev) {
                console.log(
                  `[Better Auth] Setting activeOrganizationId to ${userOrganization.id} (${userOrganization.name}) for user ${session.userId}`,
                );
              }
              return {
                data: {
                  ...session,
                  activeOrganizationId: userOrganization.id,
                },
              };
            } else {
              if (isDev) {
                console.log(
                  `[Better Auth] No organization found for user ${session.userId}`,
                );
              }
              return {
                data: session,
              };
            }
          } catch (error) {
            // Always log errors, even in production
            console.error('[Better Auth] Session creation hook error:', error);
            return {
              data: session,
            };
          }
        },
      },
    },
  },
  hooks: {
    after: createAuthMiddleware(async (ctx) => {
      if (!ctx.path.startsWith('/admin/')) return;

      const session = ctx.context?.session;
      const userId = session?.user?.id;
      if (!userId) return;

      const descriptions: Record<string, string> = {
        '/admin/impersonate-user': 'Impersonated a user',
        '/admin/stop-impersonating': 'Stopped impersonating a user',
        '/admin/ban-user': 'Banned a user',
        '/admin/unban-user': 'Unbanned a user',
        '/admin/set-role': 'Changed a user role',
        '/admin/set-user-password': 'Reset a user password',
        '/admin/create-user': 'Created a user',
        '/admin/update-user': 'Updated a user',
        '/admin/remove-user': 'Removed a user',
        '/admin/revoke-user-session': 'Revoked a user session',
        '/admin/revoke-user-sessions': 'Revoked all user sessions',
      };

      const description = descriptions[ctx.path];
      if (!description) return;

      try {
        let organizationId = (session.session as Record<string, unknown>)
          ?.activeOrganizationId as string | undefined;

        if (!organizationId) {
          const userOrg = await db.organization.findFirst({
            where: { members: { some: { userId } } },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });

          if (!userOrg) {
            console.error(
              '[Auth] SECURITY: Admin action blocked — no organization could be resolved for admin user',
              { userId, path: ctx.path },
            );
            throw new Error(
              'Admin action blocked: unable to resolve organization for audit trail',
            );
          }

          organizationId = userOrg.id;
        }

        await db.auditLog.create({
          data: {
            userId,
            memberId: null,
            organizationId,
            entityType: null,
            entityId: null,
            description: `[Platform Admin] ${description}`,
            data: {
              action: description,
              method: 'POST',
              path: ctx.path,
              resource: 'admin',
              permission: 'platform-admin',
            },
          },
        });
      } catch (err) {
        console.error('[Auth] Failed to write admin audit log:', err);
      }
    }),
  },
  // SECRET_KEY is validated at startup via validateSecurityConfig()
  secret: process.env.SECRET_KEY as string,
  plugins: [
    organization({
      membershipLimit: 100000000000,
      async sendInvitationEmail(data) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Auth] Sending invitation to:', data.email);
        }
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ??
          process.env.BETTER_AUTH_URL ??
          'https://app.trycomp.ai';
        const inviteLink = `${appUrl}/invite/${data.invitation.id}`;
        await triggerEmail({
          to: data.email,
          subject: `You've been invited to join ${data.organization.name} on Comp AI`,
          react: InviteEmail({
            organizationName: data.organization.name,
            inviteLink,
            email: data.email,
          }),
        });
      },
      ac: ac,
      roles: allRoles,
      // Enable dynamic access control for custom roles
      // This allows organizations to create custom roles at runtime
      // Roles are stored in better-auth's internal tables
      dynamicAccessControl: {
        enabled: true,
        // Limit custom roles per organization to prevent abuse
        maximumRolesPerOrganization: 100,
      },
      schema: {
        organization: {
          modelName: 'Organization',
        },
        // Custom roles table for dynamic access control
        organizationRole: {
          modelName: 'OrganizationRole',
          fields: {
            role: 'name',
            permission: 'permissions',
          },
        },
      },
    }),
    magicLink({
      expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      sendMagicLink: async ({ email, url }) => {
        // The `url` from better-auth points to the API's verify endpoint
        // and includes the callbackURL from the client's sign-in request.
        // Flow: user clicks link → API verifies token & sets session cookie
        // → API redirects (302) to callbackURL (the app).
        // AT-PATCH: LOG_MAGIC_LINKS is a deliberate bootstrap escape hatch.
        //
        // This deployment sends no email (Comp has no SMTP path; Resend is
        // hard-wired and we did not want another US processor) and has no
        // OAuth provider configured yet. emailAndPassword is disabled just
        // below, so magic link and OTP are the ONLY ways in -- and both need
        // working email. That is a locked door.
        //
        // With this set, the URL is written to the container log so an
        // operator with server access can complete a first sign-in. It grants
        // nothing to anyone who cannot already read container logs, i.e.
        // nobody who is not already root on the host.
        //
        // TURN THIS OFF once a real login path exists (an OAuth provider, or
        // email delivery). Leaving it on means every magic link for every
        // user is sitting in the log.
        if (process.env.NODE_ENV === 'development' || process.env.LOG_MAGIC_LINKS === '1') {
          console.log('[Auth] Sending magic link to:', email);
          console.log('[Auth] Magic link URL:', url);
        }
        try {
          await triggerEmail({
            to: email,
            subject: 'Login to Comp AI',
            react: MagicLinkEmail({ email, url }),
          });
        } catch (err) {
          // AT-PATCH: with no real email provider the send always throws. The
          // verification token is already persisted at this point, so the
          // logged URL is valid; swallowing here keeps the sign-in request
          // from returning an error for a link that actually works. Only
          // swallowed while the bootstrap flag is on -- otherwise a genuine
          // delivery failure must still surface.
          if (process.env.LOG_MAGIC_LINKS !== '1') throw err;
          console.warn('[Auth] magic link email send failed (LOG_MAGIC_LINKS on):', err);
        }
      },
    }),
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      async sendVerificationOTP({ email, otp }) {
        if (process.env.NODE_ENV === 'development') {
          console.log('[Auth] Sending OTP to:', email);
        }
        await triggerEmail({
          to: email,
          subject: 'One-Time Password for Comp AI',
          react: OTPVerificationEmail({ email, otp }),
        });
      },
    }),
    multiSession(),
    bearer(),
    admin({
      defaultRole: 'user',
    }),
    // OAuth 2.0 / OIDC provider for hosted MCP (Gram). Wraps oidcProvider and
    // exposes /api/auth/mcp/* (authorize, token, register) + the two
    // /api/auth/.well-known/* discovery docs, plus the auth.api.getMcpSession()
    // helper used by HybridAuthGuard. (Gram points its OAuth proxy at /mcp/*.)
    mcp({
      loginPage: mcpLoginPage,
      ...(process.env.MCP_RESOURCE_URL
        ? { resource: process.env.MCP_RESOURCE_URL }
        : {}),
      oidcConfig: {
        loginPage: mcpLoginPage,
        allowDynamicClientRegistration: false,
        ...(gramMcpClient ? { trustedClients: [gramMcpClient] } : {}),
      },
    }),
  ],
  socialProviders,
  user: {
    modelName: 'User',
    changeEmail: {
      enabled: true,
      // Double opt-in: this link goes to the CURRENT address; confirming it
      // makes better-auth send a verification link to the NEW address (via
      // emailVerification.sendVerificationEmail), which applies the change.
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        await triggerEmail({
          to: user.email,
          subject: 'Confirm your email change for Comp AI',
          react: ChangeEmailConfirmationEmail({
            currentEmail: user.email,
            newEmail,
            url,
          }),
        });
      },
    },
  },
  organization: {
    modelName: 'Organization',
  },
  member: {
    modelName: 'Member',
  },
  invitation: {
    modelName: 'Invitation',
  },
  session: {
    modelName: 'Session',
  },
  account: {
    modelName: 'Account',
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'github', 'microsoft'],
    },
    // Skip the state cookie CSRF check for OAuth flows.
    // In our cross-origin setup (app/portal → API), the state cookie may not
    // survive the OAuth redirect flow. The OAuth state parameter stored in the
    // database already provides CSRF protection (random 32-char string validated
    // against the DB). This is the same approach better-auth's oAuthProxy plugin uses.
    skipStateCookieCheck: true,
  },
  verification: {
    modelName: 'Verification',
  },
});

export type Auth = typeof auth;
