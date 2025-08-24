import { NextRequest } from 'next/server';
import { createConversationAction, deleteConversationAction, listConversationsAction, updateConversationTitleAction } from '@/app/actions/conversations';
import { getCurrentUser } from '@/app/actions/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  console.info('[API/conversations] GET.start', { requestId, userId: user.sub });
  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search') || undefined;
  const list = await listConversationsAction(search || undefined);
  console.info('[API/conversations] GET.done', { requestId, count: Array.isArray(list) ? list.length : 0 });
  return Response.json(list);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  console.info('[API/conversations] POST.start', { requestId, userId: user.sub });
  const body = await req.json();
  const doc = await createConversationAction(body);
  if ((doc as any).error) return new Response(JSON.stringify(doc), { status: 400 });
  console.info('[API/conversations] POST.done', { requestId, id: (doc as any)?.id });
  return Response.json(doc);
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const { id, title } = await req.json();
  const res = await updateConversationTitleAction(id, title);
  if (!res.ok) {
    console.error('[API/conversations] PUT.error', { requestId, id, error: res.error });
    return new Response(JSON.stringify(res), { status: 400 });
  }
  console.info('[API/conversations] PUT.done', { requestId, id });
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
    console.error('[API/conversations] DELETE.error', { requestId, id, error: res.error });
    return new Response(JSON.stringify(res), { status: 400 });
  }
  console.info('[API/conversations] DELETE.done', { requestId, id });
  return Response.json(res);
}


