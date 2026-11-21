import type { NextFunction, Request, Response } from 'express';

const aliases: Record<string, string> = {
  '/api/auth/mcp/authorize': '/api/auth/oauth2/authorize',
  '/api/auth/mcp/token': '/api/auth/oauth2/token',
  '/api/auth/mcp/register': '/api/auth/oauth2/register',
  '/api/auth/mcp/userinfo': '/api/auth/oauth2/userinfo',
};

export function legacyMcpRoutes(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const query = req.url.indexOf('?');
  const pathname = query < 0 ? req.url : req.url.slice(0, query);
  const canonical = aliases[pathname];
  if (canonical) {
    req.url = canonical + (query < 0 ? '' : req.url.slice(query));
    req.originalUrl = req.url;
  }
  next();
}
