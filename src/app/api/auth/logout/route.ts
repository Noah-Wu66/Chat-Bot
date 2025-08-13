import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export async function POST() {
  try {
    clearAuthCookie();
    return NextResponse.json({ success: true, redirect: '/login' });
  } catch (err) {
    console.error('Logout error:', err);
    return NextResponse.json({ error: '退出失败' }, { status: 500 });
  }
}

