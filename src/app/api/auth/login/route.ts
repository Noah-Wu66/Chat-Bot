import { NextRequest, NextResponse } from 'next/server';
import { findUserByUsernameOrEmail } from '@/lib/mongodb';
import { verifyPassword, signJWT, setAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { identifier, password, remember } = body || {};

    if (!identifier || !password) {
      return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
    }

    const user = await findUserByUsernameOrEmail(identifier);
    if (!user) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const token = signJWT({ sub: user.id, username: user.username, email: user.email }, remember ? 60 * 60 * 24 * 30 : undefined);
    setAuthCookie(token, !!remember);

    return NextResponse.json({ success: true, redirect: '/' }, { status: 200 });
  } catch (err) {
    console.error('Login error:', err);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}

