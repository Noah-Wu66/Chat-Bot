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

  // 放行公开路径
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // 仅保护需要鉴权的 API 路由，其它页面可未登录访问
  const PROTECTED_API_PREFIXES = ['/api/gpt-5', '/api/gemini-2.5-flash-image-preview', '/api/conversations'];
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtectedApi) {
    return NextResponse.next();
  }

  // 仅当访问受保护 API 且未携带 auth_token 时提示未登录
  const token = req.cookies.get('auth_token')?.value;
  if (!token) {
    return new NextResponse(JSON.stringify({ error: '未登录' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

