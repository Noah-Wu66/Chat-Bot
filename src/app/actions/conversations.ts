'use server'
import { generateId } from '@/utils/helpers';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';

export async function listConversationsAction(search?: string) {
  const user = await getCurrentUser();
  if (!user) return [];
  const Conversation = await getConversationModel();
  const query: any = { userId: user.sub };
  if (search && search.trim()) {
    query.title = { $regex: search.trim(), $options: 'i' };
  }
  const list = await Conversation.find(query).sort({ updatedAt: -1 }).lean();
  return list;
}

export async function createConversationAction(input: {
  title: string;
  model: string;
  settings: Record<string, any>;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: '未登录' };
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
  return JSON.parse(JSON.stringify(doc));
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


