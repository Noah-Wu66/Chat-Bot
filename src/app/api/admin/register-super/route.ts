import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getUserModel } from '@/lib/models/User';
import { verifyJWT, signJWT, setAuthCookie } from '@/lib/auth';

export const runtime = 'nodejs';

function getSuperKey(): string {
  const key = process.env.SUPER_ADMIN_KEY || process.env.ADMIN_SECRET || '';
  return key || 'PLEASE_CHANGE_ME';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { key } = body as { key?: string };
    if (!key || key !== getSuperKey()) {
      return new Response(JSON.stringify({ error: '密钥不正确' }), { status: 400 });
    }

    const cookieStore = cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
    const payload = verifyJWT(token);
    if (!payload) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

    const User = await getUserModel();
    const existingCount = await User.countDocuments({ isSuperAdmin: true });
    if (existingCount > 0) {
      return new Response(JSON.stringify({ error: '系统已存在超级管理员' }), { status: 400 });
    }

    await User.updateOne({ id: payload.sub }, { $set: { isSuperAdmin: true } });

    const fresh = await User.findOne({ id: payload.sub }).lean();
    if (!fresh) return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404 });
    const newToken = signJWT({
      sub: fresh.id,
      username: fresh.username,
      email: fresh.email,
      isSuperAdmin: true,
      isBanned: Boolean((fresh as any).isBanned),
    });
    setAuthCookie(newToken, false);

    return Response.json({ ok: true });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '注册失败' }), { status: 500 });
  }
}


