import { getRunLogModel } from '@/lib/models/RunLog';
import { generateId } from '@/utils/helpers';

export type LogRoute = 'responses' | 'chat' | 'router' | 'conversations' | 'auth';
export type LogLevel = 'info' | 'warn' | 'error';

export async function logRun(
  route: LogRoute,
  level: LogLevel,
  stage: string,
  message: string,
  meta?: Record<string, any>,
  requestId?: string
): Promise<void> {
  try {
    const RunLog = await getRunLogModel();
    await RunLog.create({
      id: generateId(),
      requestId: requestId || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
      route,
      level,
      stage,
      message,
      meta: meta || undefined,
      createdAt: new Date(),
    });
  } catch (e) {
    // 避免日志失败影响主流程
  }
  // 同步输出到服务端控制台，便于在 Vercel Logs 查看
  try {
    const ts = new Date().toISOString();
    const prefix = `[RunLog][${route}][${level}] ${stage} @ ${ts}`;
    const payload = meta ? { requestId, meta } : { requestId };
    // eslint-disable-next-line no-console
    (console as any)[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](prefix, message, payload);
  } catch {
    // ignore console failure
  }
}

export const logInfo = (route: LogRoute, stage: string, message: string, meta?: Record<string, any>, requestId?: string) =>
  logRun(route, 'info', stage, message, meta, requestId);
export const logWarn = (route: LogRoute, stage: string, message: string, meta?: Record<string, any>, requestId?: string) =>
  logRun(route, 'warn', stage, message, meta, requestId);
export const logError = (route: LogRoute, stage: string, message: string, meta?: Record<string, any>, requestId?: string) =>
  logRun(route, 'error', stage, message, meta, requestId);


