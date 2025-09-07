import { NextRequest } from 'next/server';
import { generateId } from '@/utils/helpers';
import { getUserModel } from '@/lib/models/User';
import { hashPassword } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, email, password, confirmPassword } = body;

  try {
    if (!username || username.trim().length < 3) {
      return new Response(JSON.stringify({ error: '用户名至少3个字符' }), { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: '邮箱格式不正确' }), { status: 400 });
    }
    if (password !== confirmPassword) {
      return new Response(JSON.stringify({ error: '两次输入的密码不一致' }), { status: 400 });
    }
    if (
      password.length < 8 ||
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      return new Response(JSON.stringify({ error: '密码至少8位，且包含大小写字母和数字' }), { status: 400 });
    }

    const User = await getUserModel();
    const exists = await User.findOne({ $or: [{ username }, { email }] }).lean();
    if (exists) {
      return new Response(JSON.stringify({ error: '用户名或邮箱已被占用' }), { status: 400 });
    }

    const passwordHash = await hashPassword(password);
    await User.create({
      id: generateId(),
      username: username.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      createdAt: new Date(),
    });

    return Response.json({ ok: true, redirect: '/login' });
  } catch (error: any) {
    console.error('[注册] 请求失败:', error?.message || String(error));
    return new Response(JSON.stringify({ error: '注册失败' }), { status: 500 });
  }
}


