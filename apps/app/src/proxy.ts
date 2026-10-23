import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: [
    // Skip auth-related routes and static assets
    '/((?!api|_next/static|_next/image|favicon.ico|monitoring|ingest|research|.*\\.svg$|.*\\.png$|.*\\.jpg$|.*\\.ico$|.*\\.webp$).*)',
  ],
};

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/source' || request.nextUrl.pathname.startsWith('/source/')) {
    return NextResponse.next();
  }
  try {
    // Check for session cookies across all environment prefixes
    const sessionToken =
      request.cookies.get('__Secure-better-auth.session_token')?.value ||
      request.cookies.get('better-auth.session_token')?.value ||
      request.cookies.get('__Secure-staging.session_token')?.value ||
      request.cookies.get('staging.session_token')?.value ||
      // AT-PATCH: the __Secure- variant of the `local` prefix was missing,
      // and it is the exact combination a self-hosted HTTPS deployment
      // produces. apps/api getCookieDomain() only recognises trycomp.ai
      // hosts and returns undefined for anything else, which selects
      // cookiePrefix 'local' (the dev naming); better-auth independently
      // adds the __Secure- prefix because baseURL is https (the prod
      // behaviour). Upstream never sees `local` over https, so the pairing
      // is unreachable in their environments.
      //
      // Without this the middleware finds no token and redirects to /auth
      // BEFORE any page runs -- while the API happily validates the very
      // same cookie. That split is what makes it look like login "worked"
      // and then silently didn't.
      request.cookies.get('__Secure-local.session_token')?.value ||
      request.cookies.get('local.session_token')?.value;
    const hasToken = Boolean(sessionToken);
    const nextUrl = request.nextUrl;
    const requestHeaders = new Headers(request.headers);
    const intent = nextUrl.searchParams.get('intent') || '';
    if (intent) requestHeaders.set('x-intent', intent);

    // Add x-path-name and selected query hints for server components
    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
    response.headers.set('x-pathname', nextUrl.pathname);

    // Allow unauthenticated access to invite routes
    if (nextUrl.pathname.startsWith('/invite/')) {
      return response;
    }

    // Allow unauthenticated access to unsubscribe routes
    if (nextUrl.pathname === '/unsubscribe' || nextUrl.pathname.startsWith('/unsubscribe/')) {
      return response;
    }

    // 1. Not authenticated
    if (!hasToken && nextUrl.pathname !== '/auth') {
      const url = new URL('/auth', request.url);
      // Preserve existing search params
      nextUrl.searchParams.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
      const originalPath = `${nextUrl.pathname}${nextUrl.search}`;
      if (originalPath !== '/') {
        url.searchParams.set('redirectTo', originalPath);
      }
      return NextResponse.redirect(url);
    }

    const billingAddOnMatch = nextUrl.pathname.match(
      /^\/([^/]+)\/settings\/billing\/add-ons\/([^/]+)$/,
    );
    if (billingAddOnMatch) {
      const [, orgId, addOn] = billingAddOnMatch;
      const url = new URL(`/${orgId}/settings/billing`, request.url);
      nextUrl.searchParams.forEach((value, key) => {
        url.searchParams.set(key, value);
      });
      url.searchParams.set('addOn', addOn);
      return NextResponse.rewrite(url);
    }

    // Org existence and membership checks happen in the app layouts/pages so
    // users get the proper redirect instead of a raw 403 response from middleware.

    return response;
  } catch (err) {
    console.error('[Proxy] error', err);
    return NextResponse.next();
  }
}
