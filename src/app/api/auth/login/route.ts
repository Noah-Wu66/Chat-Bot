import { NextRequest } from 'next/server';
import { getUserModel } from '@/lib/models/User';
import {
  verifyPassword,
  signJWT,
  setAuthCookie,
} from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { identifier, password, remember } = body;
  
  try {
    const User = await getUserModel();
    const lower = identifier.trim().toLowerCase();
    const user = await User.findOne({
      $or: [{ username: identifier.trim() }, { email: lower }],
    }).lean();

    if (!user) {
      return new Response(JSON.stringify({ error: '用户不存在或密码错误' }), { status: 400 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return new Response(JSON.stringify({ error: '用户不存在或密码错误' }), { status: 400 });
    }

    const token = signJWT({
      sub: user.id,
      username: user.username,
      email: user.email,
    }, remember ? 60 * 60 * 24 * 30 : undefined);

    setAuthCookie(token, Boolean(remember));
    return Response.json({ ok: true, redirect: '/' });
  } catch (error: any) {
    console.error('[登录] 请求失败:', error?.message || String(error));
    return new Response(JSON.stringify({ error: '登录失败' }), { status: 500 });
  }
}


