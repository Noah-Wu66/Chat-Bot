export interface MetasoWebpageItem {
  title: string;
  link: string;
  score?: string;
  snippet?: string;
  summary?: string;
  position?: number;
  authors?: string[];
  date?: string;
}

export interface MetasoSearchResponse {
  credits?: number;
  searchParameters?: Record<string, any>;
  webpages?: MetasoWebpageItem[];
  total?: number;
}

export interface WebSearchOptions {
  q: string;
  size?: number;
  includeSummary?: boolean;
  includeRawContent?: boolean;
  conciseSnippet?: boolean;
  scope?: 'webpage' | 'paper' | 'code' | string;
}

function getMetasoApiKey(): string | null {
  if (typeof process !== 'undefined' && process.env && process.env.METASO_API_KEY) {
    return process.env.METASO_API_KEY as string;
  }
  return null;
}

export async function metasoSearch(options: WebSearchOptions): Promise<MetasoSearchResponse | null> {
  const apiKey = getMetasoApiKey();
  if (!apiKey) return null;

  const payload = {
    q: options.q,
    scope: options.scope || 'webpage',
    includeSummary: options.includeSummary !== false,
    size: String(options.size || 10),
    includeRawContent: options.includeRawContent === true ? true : false,
    conciseSnippet: options.conciseSnippet === true ? true : false,
  } as any;

  const res = await fetch('https://metaso.cn/api/v1/search', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return null;
  }
  try {
    const data = (await res.json()) as MetasoSearchResponse;
    return data;
  } catch {
    return null;
  }
}

export function summarizeSearchToMarkdown(result: MetasoSearchResponse, maxItems: number = 5): string {
  const items = Array.isArray(result?.webpages) ? result.webpages.slice(0, maxItems) : [];
  if (items.length === 0) return '未检索到可用的结果。';

  const lines: string[] = [];
  lines.push('以下为联网搜索到的相关线索（已为你整理）：');
  lines.push('');

  for (const item of items) {
    const pos = typeof item.position === 'number' ? `#${item.position} ` : '';
    const title = item.title || '未命名页面';
    const link = item.link || '';
    const brief = item.summary || item.snippet || '';
    lines.push(`- ${pos}${title}` + (link ? ` (${link})` : ''));
    if (brief) {
      lines.push(`  - 摘要：${brief}`);
    }
  }

  lines.push('');
  lines.push('请结合上述最新结果作答，并在不确定时明确说明。');
  return lines.join('\n');
}


