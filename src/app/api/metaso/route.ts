// Metaso Search Proxy API Route
export const runtime = 'nodejs';

function getApiKey(): string | null {
  if (typeof process !== 'undefined' && process.env && process.env.METASO_API_KEY) {
    return process.env.METASO_API_KEY as string;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      q,
      size,
      includeSummary,
      includeRawContent,
      conciseSnippet,
      scope,
    } = body || {};

    if (!q || typeof q !== 'string') {
      return new Response(JSON.stringify({ error: '缺少参数 q' }), { status: 400 });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      return new Response(JSON.stringify({ error: '服务未配置 METASO_API_KEY' }), { status: 500 });
    }

    const payload: Record<string, any> = {
      q,
      scope: scope || 'webpage',
      includeSummary: includeSummary !== false,
      size: String(typeof size === 'number' ? size : size || 10),
      includeRawContent: includeRawContent === true ? true : false,
      conciseSnippet: conciseSnippet === true ? true : false,
    };

    const upstream = await fetch('https://metaso.cn/api/v1/search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // Vercel/Next 不需要额外 agent 配置
    });

    const text = await upstream.text();
    const status = upstream.status;
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json',
    } as Record<string, string>;

    return new Response(text, { status, headers });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ error: e?.message || 'metaso 转发失败' }),
      { status: 500 }
    );
  }
}


