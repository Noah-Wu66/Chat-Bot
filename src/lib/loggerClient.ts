let activeTimers: Record<string, number> = {};
let lastKeyByRequest: Record<string, string> = {};

function formatEntry(entry: any) {
  const { route, level, stage, message, requestId, createdAt, meta } = entry || {};
  const ts = createdAt ? new Date(createdAt).toISOString() : new Date().toISOString();
  const prefix = `[RunLog][${route}][${level}] ${stage} @ ${ts}`;
  try {
    // eslint-disable-next-line no-console
    (console as any)[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
      prefix,
      message,
      meta ? { requestId, meta } : { requestId }
    );
  } catch {
    // ignore
  }
}

export async function printRunLogsOnce(requestId: string): Promise<void> {
  if (!requestId) return;
  try {
    const res = await fetch(`/api/runlogs?requestId=${encodeURIComponent(requestId)}&limit=500`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const items = await res.json();
    const list = Array.isArray(items) ? items : [];
    // 升序打印
    list.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    for (const item of list) formatEntry(item);
  } catch {
    // ignore
  }
}

export function watchRunLogsToConsole(requestId: string, intervalMs = 800): () => void {
  if (!requestId) return () => {};
  const key = requestId;
  // 清理已有
  if (activeTimers[key]) {
    clearInterval(activeTimers[key]);
    delete activeTimers[key];
  }
  lastKeyByRequest[key] = '';
  const timer = window.setInterval(async () => {
    try {
      const res = await fetch(`/api/runlogs?requestId=${encodeURIComponent(requestId)}&limit=200`, { credentials: 'include' });
      if (!res.ok) return;
      const items = await res.json();
      const list = Array.isArray(items) ? items : [];
      list.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      // 仅打印新增
      let started = false;
      for (const item of list) {
        const composite = `${item.createdAt}|${item.stage}|${item.level}|${item.message}`;
        if (!started && lastKeyByRequest[key] && composite === lastKeyByRequest[key]) {
          started = true;
          continue;
        }
        if (!lastKeyByRequest[key] || started) {
          formatEntry(item);
        }
      }
      if (list.length > 0) {
        const last = list[list.length - 1];
        lastKeyByRequest[key] = `${last.createdAt}|${last.stage}|${last.level}|${last.message}`;
      }
    } catch {
      // ignore
    }
  }, Math.max(300, intervalMs));
  activeTimers[key] = timer;
  return () => {
    if (activeTimers[key]) {
      clearInterval(activeTimers[key]);
      delete activeTimers[key];
    }
    delete lastKeyByRequest[key];
  };
}


