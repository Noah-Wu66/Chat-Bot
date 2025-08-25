import { NextRequest } from 'next/server';
import { createConversationAction, deleteConversationAction, listConversationsAction, updateConversationTitleAction } from '@/app/actions/conversations';
import { getCurrentUser } from '@/app/actions/auth';
import { logInfo } from '@/lib/logger';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  await logInfo('conversations', 'request.start', '请求开始', { userId: user.sub }, requestId);
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const list = await listConversationsAction(search || undefined);
  await logInfo('conversations', 'request.done', '请求完成', { count: Array.isArray(list) ? list.length : 0 }, requestId);
  return Response.json(list);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  await logInfo('conversations', 'request.start', '请求开始', { userId: user.sub }, requestId);
  const body = await req.json();
  const doc = await createConversationAction(body);
  if ((doc as any).error) return new Response(JSON.stringify(doc), { status: 400 });
  await logInfo('conversations', 'request.done', '请求完成', { id: (doc as any)?.id }, requestId);
  return Response.json(doc);
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const { id, title } = await req.json();
  const res = await updateConversationTitleAction(id, title);
  if (!res.ok) {
    await logInfo('conversations', 'request.error', '请求失败', { id, error: res.error }, requestId);
    return new Response(JSON.stringify(res), { status: 400 });
  }
  await logInfo('conversations', 'request.done', '请求完成', { id }, requestId);
  return Response.json(res);
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: '缺少 id' }), { status: 400 });
  const res = await deleteConversationAction(id);
  if (!res.ok) {
    await logInfo('conversations', 'request.error', '请求失败', { id, error: res.error }, requestId);
    return new Response(JSON.stringify(res), { status: 400 });
  }
  await logInfo('conversations', 'request.done', '请求完成', { id }, requestId);
  return Response.json(res);
}


