import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
  '/_next',
  '/favicon.ico'
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 允许公开路径
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 仅检查是否存在 auth_token Cookie，避免在 Edge 中使用 Node crypto
  const token = req.cookies.get('auth_token')?.value;
  if (!token) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

