import { clearAuthCookie } from '@/lib/auth';

export async function POST() {
  try {
    clearAuthCookie();
    return Response.json({ ok: true, redirect: '/login' });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '退出失败' }), { status: 500 });
  }
}


