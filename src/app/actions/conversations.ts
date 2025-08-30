'use server'
import { generateId } from '@/utils/helpers';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';
import type { Conversation, Message } from '@/lib/types';

export async function listConversationsAction(search?: string): Promise<Conversation[]> {
  const user = await getCurrentUser();
  if (!user) return [] as Conversation[];
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
  return normalized;
}

export async function createConversationAction(input: {
  title: string;
  model: string;
  settings: Record<string, any>;
}): Promise<Conversation> {
  const user = await getCurrentUser();
  if (!user) throw new Error('未登录');
  const Conversation = await getConversationModel();
  const id = generateId();
  const now = new Date();
  const doc = await Conversation.create({
    id,
    userId: user.sub,
    title: input.title || '新对话',
    messages: [],
    createdAt: now,
    updatedAt: now,
    model: input.model,
    settings: input.settings || {},
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
  return out;
}

export async function updateConversationTitleAction(id: string, title: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: '未登录' };
  const Conversation = await getConversationModel();
  await Conversation.updateOne({ id, userId: user.sub }, { $set: { title } });
  return { ok: true };
}

export async function deleteConversationAction(id: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: '未登录' };
  const Conversation = await getConversationModel();
  await Conversation.deleteOne({ id, userId: user.sub });
  return { ok: true };
}


