import type { BetterAuthOptions } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';
import { db } from '@db';

export const authDatabaseHooks = {
  session: {
    create: {
      before: async (session) => {
        const isDev = process.env.NODE_ENV === 'development';
        if (isDev)
          console.log(
            '[Better Auth] Session creation hook called for user:',
            session.userId,
          );
        try {
          const organization = await db.organization.findFirst({
            where: { members: { some: { userId: session.userId } } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true },
          });
          if (organization) {
            if (isDev)
              console.log(
                `[Better Auth] Setting activeOrganizationId to ${organization.id} (${organization.name}) for user ${session.userId}`,
              );
            return {
              data: { ...session, activeOrganizationId: organization.id },
            };
          }
          if (isDev)
            console.log(
              `[Better Auth] No organization found for user ${session.userId}`,
            );
          return { data: session };
        } catch (error) {
          console.error('[Better Auth] Session creation hook error:', error);
          return { data: session };
        }
      },
    },
  },
} satisfies NonNullable<BetterAuthOptions['databaseHooks']>;

export const authLifecycleHooks = {
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
        const organization = await db.organization.findFirst({
          where: { members: { some: { userId } } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
        if (!organization) {
          console.error(
            '[Auth] SECURITY: Admin action blocked — no organization could be resolved for admin user',
            { userId, path: ctx.path },
          );
          throw new Error(
            'Admin action blocked: unable to resolve organization for audit trail',
          );
        }
        organizationId = organization.id;
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
    } catch (error) {
      console.error('[Auth] Failed to write admin audit log:', error);
    }
  }),
};
