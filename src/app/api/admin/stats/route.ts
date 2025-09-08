import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { getConversationModel } from '@/lib/models/Conversation';
import { verifyJWT } from '@/lib/auth';

export const runtime = 'nodejs';

async function requireSuperAdmin(): Promise<true | Response> {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  const payload = verifyJWT(token);
  if (!payload) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  if (!payload.isSuperAdmin) return new Response(JSON.stringify({ error: '无权限' }), { status: 403 });
  return true;
}

export async function GET(req: NextRequest) {
  const ok = await requireSuperAdmin();
  if (ok !== true) return ok as Response;
  try {
    const Conversation = await getConversationModel();
    // 从所有对话的 messages 中，统计 role=assistant 的 model 次数，按 userId 汇总
    const pipeline = [
      { $unwind: '$messages' },
      { $match: { 'messages.role': 'assistant', 'messages.model': { $exists: true, $ne: null } } },
      { $group: { _id: { userId: '$userId', model: '$messages.model' }, count: { $sum: 1 } } },
      { $group: { _id: '$_id.userId', models: { $push: { model: '$_id.model', count: '$count' } } } },
      { $project: { _id: 0, userId: '$_id', models: 1 } },
    ] as any[];
    const result = await Conversation.aggregate(pipeline);
    return Response.json({ stats: result });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '统计失败' }), { status: 500 });
  }
}


