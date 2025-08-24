'use server'

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { generateId } from '@/utils/helpers';
import { getUserModel } from '@/lib/models/User';
import {
  hashPassword,
  verifyPassword,
  signJWT,
  setAuthCookie,
  clearAuthCookie,
  verifyJWT,
} from '@/lib/auth';

export async function registerAction(input: {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}) {
  const { username, email, password, confirmPassword } = input;

  if (!username || username.trim().length < 3) {
    return { ok: false, error: '用户名至少3个字符' };
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { ok: false, error: '邮箱格式不正确' };
  }
  if (password !== confirmPassword) {
    return { ok: false, error: '两次输入的密码不一致' };
  }
  if (
    password.length < 8 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[0-9]/.test(password)
  ) {
    return { ok: false, error: '密码至少8位，且包含大小写字母和数字' };
  }

  const User = await getUserModel();
  const exists = await User.findOne({ $or: [{ username }, { email }] }).lean();
  if (exists) {
    return { ok: false, error: '用户名或邮箱已被占用' };
  }

  const passwordHash = await hashPassword(password);
  await User.create({
    id: generateId(),
    username: username.trim(),
    email: email.trim().toLowerCase(),
    passwordHash,
    createdAt: new Date(),
  });

  return { ok: true, redirect: '/login' };
}

export async function registerFormAction(formData: FormData) {
  'use server'
  const username = String(formData.get('username') || '');
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');
  const res = await registerAction({ username, email, password, confirmPassword });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  redirect(res.redirect || '/login');
}

export async function loginAction(input: {
  identifier: string; // username or email
  password: string;
  remember?: boolean;
}) {
  const { identifier, password, remember } = input;
  const User = await getUserModel();
  const lower = identifier.trim().toLowerCase();
  const user = await User.findOne({
    $or: [{ username: identifier.trim() }, { email: lower }],
  }).lean();

  if (!user) {
    return { ok: false, error: '用户不存在或密码错误' };
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    return { ok: false, error: '用户不存在或密码错误' };
  }

  const token = signJWT({
    sub: user.id,
    username: user.username,
    email: user.email,
  }, remember ? 60 * 60 * 24 * 30 : undefined);

  setAuthCookie(token, Boolean(remember));
  return { ok: true, redirect: '/' };
}

export async function loginFormAction(formData: FormData) {
  'use server'
  const identifier = String(formData.get('identifier') || '');
  const password = String(formData.get('password') || '');
  const remember = Boolean(formData.get('remember'));
  const res = await loginAction({ identifier, password, remember });
  if (!res.ok) {
    return { ok: false, error: res.error };
  }
  redirect(res.redirect || '/');
}

export async function logoutAction() {
  clearAuthCookie();
  return { ok: true, redirect: '/login' };
}

export async function getCurrentUser() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  const payload = verifyJWT(token);
  if (!payload) return null;
  return payload;
}


