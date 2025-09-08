import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getUserModel } from '@/lib/models/User';
import { getConversationModel } from '@/lib/models/Conversation';
import { verifyJWT } from '@/lib/auth';

export const runtime = 'nodejs';

async function requireSuperAdmin(): Promise<{ ok: true; userId: string } | Response> {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const payload = verifyJWT(token);
  if (!payload) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  if (!payload.isSuperAdmin) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });
  return { ok: true, userId: payload.sub } as const;
}

export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!(auth as any).ok) return auth as Response;
  try {
    const User = await getUserModel();
    const list = await User.find({}, { passwordHash: 0 }).sort({ createdAt: -1 }).lean();
    return Response.json({ users: list });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '获取用户失败' }), { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!(auth as any).ok) return auth as Response;
  try {
    const { userId, action } = await req.json();
    if (!userId || !action) return new Response(JSON.stringify({ error: '缺少参数' }), { status: 400 });
    const User = await getUserModel();
    if (action === 'ban') {
      await User.updateOne({ id: userId }, { $set: { isBanned: true } });
      return Response.json({ ok: true });
    }
    if (action === 'unban') {
      await User.updateOne({ id: userId }, { $set: { isBanned: false } });
      return Response.json({ ok: true });
    }
    return new Response(JSON.stringify({ error: '不支持的操作' }), { status: 400 });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '更新失败' }), { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (!(auth as any).ok) return auth as Response;
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return new Response(JSON.stringify({ error: '缺少 userId' }), { status: 400 });
    const User = await getUserModel();
    const Conversation = await getConversationModel();
    await Conversation.deleteMany({ userId });
    await User.deleteOne({ id: userId });
    return Response.json({ ok: true });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '删除失败' }), { status: 500 });
  }
}


