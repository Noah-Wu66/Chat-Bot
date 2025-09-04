import { metasoSearch, summarizeSearchToMarkdown } from '@/lib/search';

// 仅保留联网搜索相关能力（由用户手动开关控制）。

/**
 * 执行联网搜索并返回可注入到提示中的 Markdown 概要。
 */
export async function performWebSearchSummary(query: string, maxItems = 5): Promise<{ markdown: string; used: boolean; sources?: any[] }> {
  try {
    const data = await metasoSearch({ q: query, size: maxItems, includeSummary: true, includeRawContent: false, conciseSnippet: false, scope: 'webpage' });
    if (!data) return { markdown: '', used: false };
    const md = summarizeSearchToMarkdown(data, maxItems);
    // 构建来源聚合：提取域名与 favicon
    const items = Array.isArray((data as any)?.webpages) ? (data as any).webpages.slice(0, maxItems) : [];
    const sources = items.map((it: any) => {
      let domain = '';
      try { domain = new URL(String(it.link || '')).hostname; } catch {}
      const favicon = domain ? `https://www.google.com/s2/favicons?sz=64&domain=${domain}` : '';
      return {
        title: it.title || '未命名页面',
        link: it.link || '',
        domain,
        position: typeof it.position === 'number' ? it.position : undefined,
        summary: it.summary || it.snippet || '',
        favicon,
      };
    });
    return { markdown: md, used: true, sources };
  } catch {
    return { markdown: '', used: false };
  }
}

