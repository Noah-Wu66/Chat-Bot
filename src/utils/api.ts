export function getBackendBaseUrl(): string {
  // 优先使用公网后端地址；若未设置，走 Next.js 重写到同容器 8000 端口
  return process.env.NEXT_PUBLIC_BACKEND_URL || '';
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const base = getBackendBaseUrl();
  const url = base ? `${base}${input}` : input;
  const headers = new Headers(init.headers || {});
  // JSON 请求默认头
  if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }

  return res;
}


