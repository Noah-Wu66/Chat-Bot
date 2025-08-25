import { logoutAction } from '@/app/actions/auth';
import { logInfo } from '@/lib/logger';

export async function POST() {
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const res = await logoutAction();
  await logInfo('auth', 'request.done', '退出完成', { ok: (res as any)?.ok }, requestId);
  return Response.json(res);
}


