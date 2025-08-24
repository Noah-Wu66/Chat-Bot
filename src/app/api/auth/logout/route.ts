import { logoutAction } from '@/app/actions/auth';

export async function POST() {
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const res = await logoutAction();
  console.info('[API/auth.logout] POST.done', { requestId, ok: (res as any)?.ok });
  return Response.json(res);
}


