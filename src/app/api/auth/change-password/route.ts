import { NextRequest } from 'next/server';
import { getUserModel } from '@/lib/models/User';
import { hashPassword, verifyPassword, verifyJWT, setAuthCookie, signJWT } from '@/lib/auth';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { currentPassword, newPassword } = body as { currentPassword?: string; newPassword?: string };

    if (!newPassword) {
      return new Response(JSON.stringify({ error: '缺少新密码' }), { status: 400 });
    }

    // 密码强度校验：至少8位，包含大小写字母和数字
    if (
      newPassword.length < 8 ||
      !/[A-Z]/.test(newPassword) ||
      !/[a-z]/.test(newPassword) ||
      !/[0-9]/.test(newPassword)
    ) {
      return new Response(JSON.stringify({ error: '密码至少8位，且包含大小写字母和数字' }), { status: 400 });
    }

    const cookieStore = cookies();
    const token = cookieStore.get('auth_token')?.value;
    if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
    const payload = verifyJWT(token);
    if (!payload) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

    const User = await getUserModel();
    const u = await User.findOne({ id: payload.sub });
    if (!u) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

    if (!u.needsPasswordReset) {
      // 非强制重置场景需校验当前密码
      if (!currentPassword) {
        return new Response(JSON.stringify({ error: '缺少当前密码' }), { status: 400 });
      }
      const ok = await verifyPassword(currentPassword, u.passwordHash);
      if (!ok) return new Response(JSON.stringify({ error: '当前密码不正确' }), { status: 400 });
    }

    // 更新密码并清除强制标记
    u.passwordHash = await hashPassword(newPassword);
    u.needsPasswordReset = false;
    await u.save();

    // 可选：刷新 Token（保持原有字段）
    const newToken = signJWT({
      sub: payload.sub,
      username: payload.username,
      email: payload.email,
      isSuperAdmin: Boolean((u as any).isSuperAdmin),
      isBanned: Boolean((u as any).isBanned),
    }, undefined);
    setAuthCookie(newToken, false);

    return Response.json({ ok: true });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '修改密码失败' }), { status: 500 });
  }
}

