import { ForbiddenException, Logger } from '@nestjs/common';
import { db } from '@db';
import { getMcpSession } from './auth.server';
import { hasAppAccess } from './app-access';
import type { AuthenticatedRequest } from './types';

const logger = new Logger('HybridAuthGuard');

export async function authenticateMcpRequest({
  request,
  headers,
}: {
  request: AuthenticatedRequest;
  headers: Headers;
}): Promise<boolean> {
  const token = await getMcpSession({
    headers,
    method: request.method,
    path: request.url,
  }).catch(() => null);
  if (!token?.userId) return false;
  const userId = token.userId;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true },
  });
  if (!user) return false;
  request.userId = user.id;
  request.userEmail = user.email;
  request.userRoles = null;
  request.organizationId = '';
  request.authType = 'session';
  request.isApiKey = false;
  request.isServiceToken = false;
  request.isMcpOAuth = true;
  request.isPlatformAdmin = user.role === 'admin';
  const memberships = await db.member.findMany({
    where: { userId, deactivated: false },
    select: { id: true, role: true, department: true, organizationId: true },
  });
  if (memberships.length === 0) {
    throw new ForbiddenException(
      'This account is not a member of any organization, so it cannot use the MCP.',
    );
  }
  let member = memberships[0];
  if (memberships.length > 1) {
    const binding = await db.mcpOrgBinding.findUnique({
      where: { userId },
      select: { organizationId: true },
    });
    const chosen = binding
      ? memberships.find((m) => m.organizationId === binding.organizationId)
      : undefined;
    if (!chosen) {
      // A valid identity without a chosen tenant must not fall back to another org.
      throw new ForbiddenException(
        'This account belongs to multiple organizations. Choose your organization for AI/MCP access in Comp AI settings, then try again.',
      );
    }
    member = chosen;
  }
  if (
    !request.isPlatformAdmin &&
    !(await hasAppAccess(member.organizationId, member.role))
  ) {
    throw new ForbiddenException(
      "Your role doesn't have access to the app, so it can't use the MCP. Ask an organization admin for access.",
    );
  }
  request.organizationId = member.organizationId;
  request.memberId = member.id;
  request.memberDepartment = member.department;
  request.userRoles = member.role ? member.role.split(',') : null;
  logger.log(
    `MCP OAuth token authenticated for user ${user.id} (org ${member.organizationId})`,
  );
  return true;
}
