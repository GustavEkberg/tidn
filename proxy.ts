import { NextResponse, type NextRequest } from 'next/server';

// better-auth session cookie names
const SESSION_COOKIE = 'better-auth.session_token';
const SECURE_SESSION_COOKIE = '__Secure-better-auth.session_token';

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/', '/login'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Add pathname header for layout to detect current route
  response.headers.set('x-pathname', pathname);

  // Skip public routes - let them render normally
  if (
    PUBLIC_ROUTES.includes(pathname) ||
    PUBLIC_ROUTES.some(r => r !== '/' && pathname.startsWith(r))
  ) {
    return response;
  }

  // Check for session cookie (either secure or non-secure variant)
  const hasSession =
    request.cookies.has(SESSION_COOKIE) || request.cookies.has(SECURE_SESSION_COOKIE);

  if (!hasSession) {
    // Redirect to login if no session cookie
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'
  ]
};
