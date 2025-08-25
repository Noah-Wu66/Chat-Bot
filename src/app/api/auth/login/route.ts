import { NextRequest } from 'next/server';
import { loginAction } from '@/app/actions/auth';
import { logInfo, logError } from '@/lib/logger';

export async function POST(req: NextRequest) {
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const body = await req.json();
  await logInfo('auth', 'request.start', '登录开始', { username: body?.username }, requestId);
  const res = await loginAction(body);
  if (!res.ok) {
    await logError('auth', 'request.error', '登录失败', { error: res.error }, requestId);
    return new Response(JSON.stringify({ error: res.error }), { status: 400 });
  }
  await logInfo('auth', 'request.done', '登录完成', { userId: (res as any)?.user?.id }, requestId);
  return Response.json(res);
}


