import { getRunLogModel } from '@/lib/models/RunLog';
import { generateId } from '@/utils/helpers';
import { metasoSearch, summarizeSearchToMarkdown } from '@/lib/search';

// 模型路由功能已移除，仅保留联网搜索相关能力。

function extractFirstJsonObject(text: string): any {
  // 尝试直接解析
  try {
    return JSON.parse(text);
  } catch {
    // 从文本中提取第一个 {...}
    const match = text.match(/[\{\[][\s\S]*[\}\]]/);
    if (!match) throw new Error('No JSON found');
    return JSON.parse(match[0]);
  }
}


/**
 * 依据 gpt-4o-mini 对输入做“是否需要联网搜索”的轻量判定。
 * 返回 { shouldSearch: boolean, query: string }
 */
export async function routeWebSearchDecision(ai: any, userInputText: string, requestId?: string): Promise<{ shouldSearch: boolean; query: string }> {
  const RunLog = await getRunLogModel();
  const rid = requestId || Date.now().toString(36) + Math.random().toString(36).slice(2);
  const instruction = [
    '你是一个开关判定器：当用户的问题明显涉及到时效性、新闻、最新数据、外部网站、参考链接、排名/价格/发生时间等，需要联网搜索；否则不需要。',
    '请输出 JSON：{"shouldSearch": true|false, "query": "用于搜索的简洁中文查询"}',
    '如果不需要联网，query 可返回原问题的简短摘要。不得输出多余文字。'
  ].join('\n');

  try {
    const completion: any = await (ai as any).chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: `用户问题：\n${(userInputText || '').slice(0, 4000)}` },
        { role: 'user', content: '只输出 JSON：' },
      ],
      temperature: 0,
    } as any);
    const output = completion?.choices?.[0]?.message?.content || '';
    const obj = extractFirstJsonObject(output);
    const shouldSearch = !!obj?.shouldSearch;
    const query = typeof obj?.query === 'string' && obj.query.trim() ? obj.query.trim() : userInputText;
    await RunLog.create({ id: generateId(), requestId: rid, route: 'router', level: 'info', stage: 'websearch.decision', message: '联网搜索判定', meta: { shouldSearch, query, raw: output } });
    return { shouldSearch, query };
  } catch (e: any) {
    await RunLog.create({ id: generateId(), requestId: rid, route: 'router', level: 'warn', stage: 'websearch.decision.error', message: '联网搜索判定失败，关闭搜索', meta: { error: e?.message || String(e) } });
    return { shouldSearch: false, query: userInputText };
  }
}

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

