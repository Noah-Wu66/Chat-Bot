import { ReasoningEffort, Gpt5RoutingDecision, VerbosityLevel } from '@/lib/types';
import { getRunLogModel } from '@/lib/models/RunLog';
import { generateId } from '@/utils/helpers';
import OpenAI from 'openai';

/**
 * 使用 gpt-5-nano 对用户输入进行难度判定并路由到目标模型。
 * 目标集合：
 * - gpt-5 (effort: minimal | low | medium | high)
 * - gpt-5-chat (不传入 reasoning.effort)
 * 若返回不合法，则兜底到 gpt-5-chat。
 */
export async function routeGpt5Decision(ai: OpenAI, userInputText: string, requestId?: string): Promise<Gpt5RoutingDecision> {
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
    "2) { \"model\": \"gpt-5-chat\", \"verbosity\": \"low|medium|high\" }",
    '当问题属于简单类问题（不需要或几乎不需要推理，例如：寒暄/问候、单步事实问答、短文本改写/提取/格式化），选择 gpt-5-chat。',
    '当需要推理时，选择 gpt-5，并根据复杂度给出 effort；同时总是给出 verbosity（low/medium/high）以控制输出详细程度：',
    '- minimal: 几乎无需思考（提取、改写、非常短的事实）',
    '- low: 简单推理（一到两步思考）',
    '- medium: 中等复杂推理（多步、多条件整合）',
    '- high: 高复杂/长链条推理（需要全面规划/证明/长文综合）',
    '严格输出一个 JSON 对象，不要包含任何解释文字。',
  ].join('\n');

  // 优先使用 Responses API；失败则回退到 Chat Completions 完成路由判定
  try {
    const resp: any = await (ai as any).responses.create({
      model: 'gpt-5-nano',
      input: [
        { type: 'input_text', text: instruction },
        { type: 'input_text', text: `用户问题：\n${inputForRouting}` },
        { type: 'input_text', text: '只输出 JSON：' },
      ],
      text: { verbosity: 'low' },
    });

    let output = '';
    try {
      output = resp.output_text || '';
    } catch {
      output = JSON.stringify(resp);
    }

    // 追加：将 gpt-5-nano 的原始输出记录到运行日志，便于在浏览器控制台查看
    await RunLog.create({
      id: generateId(),
      requestId: rid,
      route: 'router',
      level: 'info',
      stage: 'routing.nano.output',
      message: 'gpt-5-nano 原始输出',
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
    // Responses 路由失败，回退到 Chat Completions 进行判定
    await RunLog.create({
      id: generateId(),
      requestId: rid,
      route: 'router',
      level: 'warn',
      stage: 'routing.recover',
      message: 'Responses 路由失败，尝试使用 Chat Completions 判定',
      meta: { error: e1?.message || String(e1) },
    });
    try {
      const completion: any = await (ai as any).chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: `用户问题：\n${inputForRouting}` },
          { role: 'user', content: '只输出 JSON：' },
        ],
        temperature: 0,
      } as any);
      const output = completion?.choices?.[0]?.message?.content || '';
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
    } catch (e2: any) {
      await RunLog.create({
        id: generateId(),
        requestId: rid,
        route: 'router',
        level: 'error',
        stage: 'routing.error',
        message: '路由器判定失败，回退到 gpt-5-chat',
        meta: { error: e2?.message || String(e2) },
      });
      return { model: 'gpt-5-chat' } as Gpt5RoutingDecision;
    }
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

  if (model === 'gpt-5-chat') {
    return { model: 'gpt-5-chat', ...(verbosity && allowedVerbosity.includes(verbosity) ? { verbosity } : {}) } as Gpt5RoutingDecision;
  }

  const allowedEfforts: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];
  if (model === 'gpt-5' && effort && allowedEfforts.includes(effort)) {
    return { model: 'gpt-5', effort, ...(verbosity && allowedVerbosity.includes(verbosity) ? { verbosity } : {}) } as Gpt5RoutingDecision;
  }

  // 非法返回，兜底
  throw new Error('Invalid decision payload');
}


