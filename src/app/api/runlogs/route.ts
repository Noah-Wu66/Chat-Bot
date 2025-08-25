import { NextRequest } from 'next/server';
import { getRunLogModel } from '@/lib/models/RunLog';
import { getCurrentUser } from '@/app/actions/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const RunLog = await getRunLogModel();
  const { searchParams } = new URL(req.url);
  const requestId = searchParams.get('requestId') || undefined;
  const route = searchParams.get('route') || undefined;
  const level = searchParams.get('level') || undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') || '200', 10) || 200, 1000);

  const query: Record<string, any> = {};
  if (requestId) query.requestId = requestId;
  if (route) query.route = route;
  if (level) query.level = level;

  const items = await RunLog.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return Response.json(items);
}


