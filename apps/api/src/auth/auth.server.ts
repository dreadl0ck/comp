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
  multiSession,
  organization,
} from 'better-auth/plugins';
import { ac, allRoles } from '@trycompai/auth';
import { mcpPlugins, readMcpConfig } from './mcp-config';
import { resolveMcpToken } from './mcp-token';
import { getBetterAuthTrustedOrigins } from './origin-policy';
import {
  getCookieDomain,
  socialProviders,
  validateSecurityConfig,
} from './auth-setup';
import { authDatabaseHooks, authLifecycleHooks } from './auth-lifecycle';

export { isTrustedOrigin } from './auth-setup';
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

validateSecurityConfig();
const cookieDomain = getCookieDomain();
export const mcpConfig = readMcpConfig(process.env);

export const auth = betterAuth({
  disabledPaths: ['/token'],
  database: prismaAdapter(db, { provider: 'postgresql' }),
  baseURL: process.env.BASE_URL || 'http://localhost:3333',
  trustedOrigins: getBetterAuthTrustedOrigins(),
  emailAndPassword: { enabled: false },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (process.env.NODE_ENV === 'development')
        console.log('[Auth] Sending verification email to:', user.email);
      await triggerEmail({
        to: user.email,
        subject: 'Verify your email for Comp AI',
        react: VerifyEmail({ email: user.email, url }),
      });
    },
  },
  advanced: {
    database: { generateId: false },
    ...(cookieDomain === '.staging.trycomp.ai' && { cookiePrefix: 'staging' }),
    ...(!cookieDomain && { cookiePrefix: 'local' }),
    ...(cookieDomain && {
      crossSubDomainCookies: { enabled: true, domain: cookieDomain },
      defaultCookieAttributes: { sameSite: 'lax' as const, secure: true },
    }),
  },
  databaseHooks: authDatabaseHooks,
  hooks: authLifecycleHooks,
  secret: process.env.SECRET_KEY as string,
  plugins: [
    organization({
      membershipLimit: 100000000000,
      async sendInvitationEmail(data) {
        if (process.env.NODE_ENV === 'development')
          console.log('[Auth] Sending invitation to:', data.email);
        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ??
          process.env.BETTER_AUTH_URL ??
          'https://app.trycomp.ai';
        await triggerEmail({
          to: data.email,
          subject: `You've been invited to join ${data.organization.name} on Comp AI`,
          react: InviteEmail({
            organizationName: data.organization.name,
            inviteLink: `${appUrl}/invite/${data.invitation.id}`,
            email: data.email,
          }),
        });
      },
      ac,
      roles: allRoles,
      dynamicAccessControl: { enabled: true, maximumRolesPerOrganization: 100 },
      schema: {
        organization: { modelName: 'Organization' },
        organizationRole: {
          modelName: 'OrganizationRole',
          fields: { role: 'name', permission: 'permissions' },
        },
      },
    }),
    magicLink({
      expiresIn: 60 * 60,
      sendMagicLink: async ({ email, url }) => {
        // Explicit bootstrap mode only: otherwise a login link must never reach logs.
        if (
          process.env.NODE_ENV === 'development' ||
          process.env.LOG_MAGIC_LINKS === '1'
        ) {
          console.log('[Auth] Sending magic link to:', email);
          console.log('[Auth] Magic link URL:', url);
        }
        try {
          await triggerEmail({
            to: email,
            subject: 'Login to Comp AI',
            react: MagicLinkEmail({ email, url }),
          });
        } catch (error) {
          if (process.env.LOG_MAGIC_LINKS !== '1') throw error;
          console.warn(
            '[Auth] magic link email send failed (LOG_MAGIC_LINKS on):',
            error,
          );
        }
      },
    }),
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      async sendVerificationOTP({ email, otp }) {
        if (process.env.NODE_ENV === 'development')
          console.log('[Auth] Sending OTP to:', email);
        await triggerEmail({
          to: email,
          subject: 'One-Time Password for Comp AI',
          react: OTPVerificationEmail({ email, otp }),
        });
      },
    }),
    multiSession(),
    bearer(),
    admin({ defaultRole: 'user' }),
    ...mcpPlugins(mcpConfig),
  ],
  socialProviders,
  user: {
    modelName: 'User',
    changeEmail: {
      enabled: true,
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
  organization: { modelName: 'Organization' },
  member: { modelName: 'Member' },
  invitation: { modelName: 'Invitation' },
  session: { modelName: 'Session' },
  account: {
    modelName: 'Account',
    accountLinking: {
      enabled: true,
      trustedProviders: ['google', 'github', 'microsoft'],
    },
    // Cross-origin social callbacks use the random, DB-validated OAuth state.
    skipStateCookieCheck: true,
  },
  verification: { modelName: 'Verification', storeInDatabase: true },
});

export function getMcpSession(input: {
  headers: Headers;
  method: string;
  path: string;
}) {
  return resolveMcpToken({ auth, config: mcpConfig, ...input });
}

export type Auth = typeof auth;
