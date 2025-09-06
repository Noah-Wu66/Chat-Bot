import { NextRequest } from 'next/server';
import { loginAction } from '@/app/actions/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const res = await loginAction(body);
  if (!res.ok) {
    console.error('[登录] 请求失败:', res.error);
    return new Response(JSON.stringify({ error: res.error }), { status: 400 });
  }
  return Response.json(res);
}


