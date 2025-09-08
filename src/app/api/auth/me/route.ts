import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getUserModel } from '@/lib/models/User';

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
    // 从数据库获取最新 isSuperAdmin / isBanned
    try {
      const User = await getUserModel();
      const u = await User.findOne({ id: payload.sub }).lean();
      if (!u) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
      const merged = { ...payload, isSuperAdmin: Boolean((u as any).isSuperAdmin), isBanned: Boolean((u as any).isBanned) };
      return Response.json({ user: merged });
    } catch {
      return Response.json({ user: payload });
    }
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }
}


