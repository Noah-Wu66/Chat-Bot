import { NextRequest } from 'next/server';
import { loginAction } from '@/app/actions/auth';

export async function POST(req: NextRequest) {
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const body = await req.json();
  console.info('[API/auth.login] POST.start', { requestId, username: body?.username });
  const res = await loginAction(body);
  if (!res.ok) {
    console.error('[API/auth.login] POST.error', { requestId, error: res.error });
    return new Response(JSON.stringify({ error: res.error }), { status: 400 });
  }
  console.info('[API/auth.login] POST.done', { requestId, userId: (res as any)?.user?.id });
  return Response.json(res);
}


