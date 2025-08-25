import type { NextRequest } from 'next/server';
import { getCurrentUser } from '@/app/actions/auth';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  return Response.json({ user });
}


