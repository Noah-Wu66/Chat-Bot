import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
    }
    
    const payload = verifyJWT(token);
    if (!payload) {
      return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
    }
    
    return Response.json({ user: payload });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }
}


