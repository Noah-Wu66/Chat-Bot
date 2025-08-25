import { getRunLogModel } from '@/lib/models/RunLog';
import { generateId } from '@/utils/helpers';

export type LogRoute = 'responses' | 'chat' | 'router';
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
}

export const logInfo = (route: LogRoute, stage: string, message: string, meta?: Record<string, any>, requestId?: string) =>
  logRun(route, 'info', stage, message, meta, requestId);
export const logWarn = (route: LogRoute, stage: string, message: string, meta?: Record<string, any>, requestId?: string) =>
  logRun(route, 'warn', stage, message, meta, requestId);
export const logError = (route: LogRoute, stage: string, message: string, meta?: Record<string, any>, requestId?: string) =>
  logRun(route, 'error', stage, message, meta, requestId);


