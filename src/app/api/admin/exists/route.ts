import { NextRequest } from 'next/server';
import { getUserModel } from '@/lib/models/User';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const User = await getUserModel();
    const count = await User.countDocuments({ isSuperAdmin: true });
    return Response.json({ exists: count > 0 });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: '查询失败' }), { status: 500 });
  }
}


