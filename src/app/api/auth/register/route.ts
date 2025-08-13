import { NextRequest, NextResponse } from 'next/server';
import { isUsernameOrEmailTaken, createUser } from '@/lib/mongodb';
import { hashPassword } from '@/lib/auth';

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, email, password, confirmPassword } = body || {};

    // 基础校验
    if (!username || !email || !password || !confirmPassword) {
      return NextResponse.json({ error: '请填写所有必填字段' }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: '邮箱格式不正确' }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: '两次输入的密码不一致' }, { status: 400 });
    }
    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json({ error: '密码至少8位，且包含大小写字母和数字' }, { status: 400 });
    }

    // 唯一性校验
    const taken = await isUsernameOrEmailTaken(username, email);
    if (taken) {
      return NextResponse.json({ error: '用户名或邮箱已被占用' }, { status: 409 });
    }

    // 创建用户
    const passwordHash = await hashPassword(password);
    await createUser({ username, email, passwordHash });

    // 注册成功，前端跳转到登录页
    return NextResponse.json({ success: true, redirect: '/login' }, { status: 201 });
  } catch (err) {
    console.error('Register error:', err);
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}

