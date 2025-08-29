import { ReasoningEffort, Gpt5RoutingDecision, VerbosityLevel } from '@/lib/types';
import { getRunLogModel } from '@/lib/models/RunLog';
import { generateId } from '@/utils/helpers';
import { metasoSearch, summarizeSearchToMarkdown } from '@/lib/search';

/**
 * 使用 gpt-4o-mini 对用户输入进行难度判定并路由到目标模型。
 * 目标集合：
 * - gpt-5 (effort: minimal | low | medium | high)
 * - gpt-5-chat (不传入 reasoning.effort)
 * 若返回不合法，则兜底到 gpt-5-chat。
 */
export async function routeGpt5Decision(ai: any, userInputText: string, requestId?: string): Promise<Gpt5RoutingDecision> {
  const RunLog = await getRunLogModel();
  const rid = requestId || Date.now().toString(36) + Math.random().toString(36).slice(2);
  await RunLog.create({
    id: generateId(),
    requestId: rid,
    route: 'router',
    level: 'info',
    stage: 'routing.start',
    message: '开始 GPT-5 路由判定',
    meta: { sample: (userInputText || '').slice(0, 160) },
  });
  // 保险处理：截断极长输入
  const inputForRouting = (userInputText || '').slice(0, 4000);

  const instruction = [
    '你是一个“模型路由器”。你的任务是根据用户问题的难易程度，返回唯一的目标模型以及可选的 effort。',
    '只允许以下两种结果：',
    "1) { \"model\": \"gpt-5\", \"effort\": \"minimal|low|medium|high\", \"verbosity\": \"low|medium|high\" }",
    "2) { \"model\": \"gpt-5-chat-latest\", \"verbosity\": \"low|medium|high\" }",
    '当问题属于简单类问题（不需要或几乎不需要推理，例如：寒暄/问候、单步事实问答、短文本改写/提取/格式化），选择 gpt-5-chat-latest。',
    '当需要推理时，选择 gpt-5，并根据复杂度给出 effort；同时总是给出 verbosity（low/medium/high）以控制输出详细程度：',
    '- minimal: 几乎无需思考（提取、改写、非常短的事实）',
    '- low: 简单推理（一到两步思考）',
    '- medium: 中等复杂推理（多步、多条件整合）',
    '- high: 高复杂/长链条推理（需要全面规划/证明/长文综合）',
    '严格输出一个 JSON 对象，不要包含任何解释文字。',
  ].join('\n');

  // 优先使用 Chat Completions（gpt-4o-mini）进行路由判定；失败则回退到 gpt-4o
  try {
    const completion: any = await (ai as any).chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: instruction },
        { role: 'user', content: `用户问题：\n${inputForRouting}` },
        { role: 'user', content: '只输出 JSON：' },
      ],
      temperature: 0,
    } as any);

    let output = completion?.choices?.[0]?.message?.content || '';

    // 追加：将 gpt-4o-mini 的原始输出记录到运行日志，便于在浏览器控制台查看
    await RunLog.create({
      id: generateId(),
      requestId: rid,
      route: 'router',
      level: 'info',
      stage: 'routing.mini.output',
      message: 'gpt-4o-mini 原始输出',
      meta: { output },
    });

    const json = extractFirstJsonObject(output);
    const decision = validateDecision(json);
    await RunLog.create({
      id: generateId(),
      requestId: rid,
      route: 'router',
      level: 'info',
      stage: 'routing.done',
      message: '路由器返回结果',
      meta: { raw: output, parsed: json, decision },
    });
    return decision;
  } catch (e1: any) {
    // 主判定模型失败，单层兜底：直接回退到 gpt-5-chat
    await RunLog.create({
      id: generateId(),
      requestId: rid,
      route: 'router',
      level: 'warn',
      stage: 'routing.recover',
      message: 'gpt-4o-mini 路由失败，回退到 gpt-5-chat-latest',
      meta: { error: e1?.message || String(e1) },
    });
    return { model: 'gpt-5-chat-latest' } as Gpt5RoutingDecision;
  }
}

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

function validateDecision(obj: any): Gpt5RoutingDecision {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid decision');

  const model = obj.model as string | undefined;
  const effort = obj.effort as ReasoningEffort | undefined;
  const verbosity = obj.verbosity as VerbosityLevel | undefined;
  const allowedVerbosity: VerbosityLevel[] = ['low', 'medium', 'high'];

  if (model === 'gpt-5-chat-latest') {
    return { model: 'gpt-5-chat-latest', ...(verbosity && allowedVerbosity.indexOf(verbosity) !== -1 ? { verbosity } : {}) } as Gpt5RoutingDecision;
  }

  const allowedEfforts: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];
  if (model === 'gpt-5' && effort && allowedEfforts.indexOf(effort) !== -1) {
    return { model: 'gpt-5', effort, ...(verbosity && allowedVerbosity.indexOf(verbosity) !== -1 ? { verbosity } : {}) } as Gpt5RoutingDecision;
  }

  // 非法返回，兜底
  throw new Error('Invalid decision payload');
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

