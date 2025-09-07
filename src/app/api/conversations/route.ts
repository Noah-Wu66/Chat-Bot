import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { generateId } from '@/utils/helpers';
import { getConversationModel } from '@/lib/models/Conversation';
import type { Conversation, Message } from '@/lib/types';

export const runtime = 'nodejs';

// 获取当前用户的辅助函数
async function getCurrentUser() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  const payload = verifyJWT(token);
  if (!payload) return null;
  return payload;
}

// 获取对话列表
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || undefined;
    
    const ConversationModel = await getConversationModel();
    const query: any = { userId: user.sub };
    if (search && search.trim()) {
      query.title = { $regex: search.trim(), $options: 'i' };
    }
    const list = await ConversationModel.find(query).sort({ updatedAt: -1 }).lean();
    const normalized: Conversation[] = (Array.isArray(list) ? list : []).map((d: any) => ({
      id: String(d.id),
      userId: String(d.userId),
      title: String(d.title),
      messages: Array.isArray(d.messages)
        ? d.messages.map((m: any) => ({
            id: String(m.id),
            role: m.role,
            content: String(m.content ?? ''),
            timestamp: new Date(m.timestamp),
            model: m.model,
            images: Array.isArray(m.images) ? m.images : undefined,
            functionCall: m.functionCall,
            functionResult: m.functionResult,
            metadata: m.metadata,
          })) as Message[]
        : [],
      createdAt: new Date(d.createdAt),
      updatedAt: new Date(d.updatedAt),
      model: String(d.model),
      settings: (d.settings && typeof d.settings === 'object') ? d.settings : {},
    }));
    return Response.json(normalized);
  } catch (error: any) {
    console.error('获取对话列表失败:', error);
    return new Response(JSON.stringify({ error: '获取对话列表失败' }), { status: 500 });
  }
}

// 创建新对话
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  
  try {
    const body = await req.json();
    const Conversation = await getConversationModel();
    const id = generateId();
    const now = new Date();
    const doc = await Conversation.create({
      id,
      userId: user.sub,
      title: body.title || '新对话',
      messages: [],
      createdAt: now,
      updatedAt: now,
      model: body.model,
      settings: body.settings || {},
    });
    const out: Conversation = {
      id: String(doc.id),
      userId: String(doc.userId),
      title: String(doc.title),
      messages: [],
      createdAt: new Date(doc.createdAt),
      updatedAt: new Date(doc.updatedAt),
      model: String(doc.model),
      settings: (doc.settings && typeof doc.settings === 'object') ? doc.settings : {},
    };
    return Response.json(out);
  } catch (error: any) {
    console.error('创建对话失败:', error);
    return new Response(JSON.stringify({ error: '创建对话失败' }), { status: 500 });
  }
}

// 更新对话标题
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  
  try {
    const { id, title } = await req.json();
    const Conversation = await getConversationModel();
    await Conversation.updateOne({ id, userId: user.sub }, { $set: { title } });
    return Response.json({ ok: true });
  } catch (error: any) {
    console.error('更新对话标题失败:', error);
    return new Response(JSON.stringify({ error: '更新对话标题失败' }), { status: 500 });
  }
}

// 删除对话
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: '缺少 id' }), { status: 400 });
    
    const Conversation = await getConversationModel();
    await Conversation.deleteOne({ id, userId: user.sub });
    return Response.json({ ok: true });
  } catch (error: any) {
    console.error('删除对话失败:', error);
    return new Response(JSON.stringify({ error: '删除对话失败' }), { status: 500 });
  }
}

// 局部更新：按消息ID截断（不含该消息）
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  try {
    const { id, op, messageId } = await req.json();
    if (!id || !op) return new Response(JSON.stringify({ error: '缺少参数' }), { status: 400 });
    if (op !== 'truncate_before') return new Response(JSON.stringify({ error: '不支持的操作' }), { status: 400 });
    if (!messageId) return new Response(JSON.stringify({ error: '缺少 messageId' }), { status: 400 });

    const Conversation = await getConversationModel();
    const doc: any = await Conversation.findOne({ id, userId: user.sub }, { messages: 1 }).lean();
    if (!doc) return new Response(JSON.stringify({ error: '对话不存在' }), { status: 404 });
    const list: any[] = Array.isArray(doc.messages) ? doc.messages : [];
    const idx = list.findIndex((m: any) => String(m?.id) === String(messageId));
    if (idx === -1) return new Response(JSON.stringify({ error: '消息不存在' }), { status: 404 });
    const truncated = list.slice(0, idx);
    await Conversation.updateOne(
      { id, userId: user.sub },
      { $set: { messages: truncated, updatedAt: new Date() } }
    );
    return Response.json({ ok: true, truncatedCount: list.length - truncated.length });
  } catch (error: any) {
    console.error('截断对话失败:', error);
    return new Response(JSON.stringify({ error: '截断对话失败' }), { status: 500 });
  }
}


