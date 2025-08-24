import { logoutAction } from '@/app/actions/auth';

export async function POST() {
  const res = await logoutAction();
  return Response.json(res);
}


