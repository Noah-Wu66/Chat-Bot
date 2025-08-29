// 使用标准 Request 类型，避免对 next/server 类型的依赖
import { getAIClient } from '@/lib/ai';
import { routeGpt5Decision, routeWebSearchDecision, performWebSearchSummary } from '@/lib/router';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';
import { logInfo, logError } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const body = await req.json();
  const { conversationId, input, model, settings, stream, webSearch } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
    webSearch?: boolean;
  };

  const ai = getAIClient();
  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  // 新：由路由器决定最终模型（不再设置终极兜底，路由失败直接报错）
  let routed: { model: 'gpt-5' | 'gpt-5-chat-latest'; effort?: 'minimal' | 'low' | 'medium' | 'high'; verbosity?: 'low' | 'medium' | 'high' };
  try {
    // 提取路由文本（若 input 为数组，优先取 input_text）
    let routingText = '';
    if (Array.isArray(input)) {
      const first = input.find((i: any) => Array.isArray(i?.content));
      const contentArr = Array.isArray(first?.content) ? first.content : [];
      const textItem = contentArr.find((c: any) => c?.type === 'input_text');
      routingText = textItem?.text || '';
    } else {
      routingText = String(input ?? '');
    }
    routed = await routeGpt5Decision(ai, routingText, requestId);
  } catch (e: any) {
    await logError('responses', 'routing.error', '路由器判定失败', { error: e?.message || String(e) }, requestId);
    return new Response(JSON.stringify({ error: '路由器判定失败' }), { status: 500 });
  }

  // 最终模型：严格使用路由器决策，忽略客户端传入的 model
  const modelToUse = routed.model;
  await logInfo('responses', 'request.start', '请求开始', {
    userId: user.sub,
    conversationId,
    model: modelToUse,
    stream: !!stream,
  }, requestId);

  // 记录用户消息（仅文本摘要记录）
  let userContent = '';
  if (Array.isArray(input)) {
    const first = input.find((i: any) => Array.isArray(i?.content));
    const contentArr = Array.isArray(first?.content) ? first.content : [];
    const textItem = contentArr.find((c: any) => c?.type === 'input_text');
    userContent = textItem?.text || '[复合输入]';
  } else {
    userContent = input;
  }

  await Conversation.updateOne(
    { id: conversationId, userId: user.sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'user',
          content: userContent,
          timestamp: new Date(),
          model,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  // 从数据库获取历史，构建用于 Responses API 的上下文输入
  const MAX_HISTORY = 30;
  const doc = await Conversation.findOne({ id: conversationId, userId: user.sub }, { messages: 1 }).lean();
  const fullHistory: any[] = Array.isArray((doc as any)?.messages) ? (doc as any).messages : [];
  // 移除刚写入的当前用户消息，避免与 input 重复；仅保留更早历史
  const historyWithoutCurrent = fullHistory.length > 0 ? fullHistory.slice(0, -1) : [];
  const buildHistoryText = (list: any[]): string => {
    const items = list.slice(-MAX_HISTORY).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'));
    return items.map((m: any) => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content ?? '')}`).join('\n');
  };
  const historyText = buildHistoryText(historyWithoutCurrent);
  // 归一化 Responses 输入为消息数组，并注入历史摘要（作为一条用户消息文本）
  const buildResponsesInputWithHistory = (src: string | any[]): any[] => {
    const dev = { role: 'developer', content: [{ type: 'input_text', text: '总是用中文回复' }] } as any;
    const historyMsg = historyText ? { role: 'user', content: [{ type: 'input_text', text: `以下是对话历史（供参考）：\n${historyText}` }] } as any : null;
    const current = Array.isArray(src)
      ? src
      : [{ role: 'user', content: [{ type: 'input_text', text: String(src ?? '') }] }] as any[];
    return [dev, ...(historyMsg ? [historyMsg] : []), ...current];
  };

  // 直接使用路由结果（路由已返回 gpt-5-chat-latest 或 gpt-5）
  const apiModelStream = modelToUse;
  // 可选：联网搜索（由路由器判定）
  let searchUsed = false;
  let injectedHistoryMsg: any | null = null;
  let searchSources: any[] | null = null;
  if (webSearch) {
    try {
      const currText = Array.isArray(input)
        ? (() => {
            const first = input.find((i: any) => Array.isArray(i?.content));
            const contentArr = Array.isArray(first?.content) ? first.content : [];
            const textItem = contentArr.find((c: any) => c?.type === 'input_text');
            return textItem?.text || '';
          })()
        : String(input ?? '');
      const decision = await routeWebSearchDecision(ai, currText, requestId);
      if (decision.shouldSearch) {
        const { markdown, used, sources } = await performWebSearchSummary(decision.query, 5);
        if (used && markdown) {
          injectedHistoryMsg = { role: 'system', content: [{ type: 'input_text', text: `以下为联网搜索到的材料（供参考，不保证准确）：\n\n${markdown}` }] } as any;
          searchUsed = true;
          searchSources = Array.isArray(sources) ? sources : null;
        }
      }
    } catch {}
  }

  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // SSE: start 事件
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'start', requestId, route: 'responses', model: modelToUse })}\n\n`
            )
          );
          // 应用路由器决策：若是 gpt-5 则传入 effort（在 settings.reasoning 下），若是 gpt-5-chat 则不传 effort
          const finalSettings: any = { ...(settings?.text ? { text: settings.text } : {}) };
          if (modelToUse === 'gpt-5') {
            finalSettings.reasoning = {
              ...(settings?.reasoning || {}),
              ...(routed && 'effort' in routed && routed.effort ? { effort: routed.effort } : {}),
            };
          }
          // 始终注入由路由器决定的输出详细程度（覆盖用户设置）
          if (!finalSettings.text) finalSettings.text = {};
          finalSettings.text.verbosity = (routed as any).verbosity || 'medium';

          let inputPayload = buildResponsesInputWithHistory(input);
          if (injectedHistoryMsg) {
            // 将搜索材料放在历史之后、当前消息之前：buildResponsesInputWithHistory 已经返回了 [dev, history?, current...]
            // 这里简化处理：如果 injected 存在，则在 dev 后面插入
            const dev = inputPayload.shift();
            inputPayload = [dev, injectedHistoryMsg, ...inputPayload];
          }
          const maxOutputTokens = typeof settings?.maxTokens === 'number' ? settings.maxTokens : undefined;
          const temperature = typeof settings?.temperature === 'number' ? settings.temperature : undefined;

          const reqPayloadStream: any = {
            model: apiModelStream,
            input: inputPayload,
            stream: true,
            ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {}),
          };
          if (modelToUse === 'gpt-5') {
            reqPayloadStream.reasoning = finalSettings.reasoning;
            reqPayloadStream.text = finalSettings.text;
          } else {
            if (typeof temperature === 'number') reqPayloadStream.temperature = temperature;
          }

          const response = await (ai as any).responses.create(reqPayloadStream);

          if (searchUsed) {
            // 提前将搜索使用情况通知到前端
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'search', used: true })}\n\n`)
            );
            if (Array.isArray(searchSources) && searchSources.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'search_sources', sources: searchSources })}\n\n`)
              );
            }
          }

          // SSE: routing 事件（声明最终模型）
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'routing', model: apiModelStream, effort: modelToUse === 'gpt-5' ? (routed as any).effort : undefined, verbosity: (routed as any).verbosity, requestId })}\n\n`
            )
          );

          let fullContent = '';
          for await (const event of response) {
            if (event.type === 'response.refusal.delta') continue;
            if (event.type === 'response.output_text.delta') {
              fullContent += event.delta || '';
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content: event.delta })}\n\n`)
              );
            } else if (event.type === 'response.reasoning.delta') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'reasoning', content: event.delta })}\n\n`)
              );
            } else if (event.type === 'response.completed') {
              // 流完成后写入助手消息
              try {
                await Conversation.updateOne(
                  { id: conversationId, userId: user.sub },
                  {
                    $push: {
                      messages: {
                        id: Date.now().toString(36),
                        role: 'assistant',
                        content: fullContent,
                        timestamp: new Date(),
                        model: modelToUse,
                        metadata: searchUsed ? { searchUsed: true, sources: searchSources || undefined } : undefined,
                      },
                    },
                    $set: { updatedAt: new Date() },
                  }
                );
              } catch {}
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
              controller.close();
              await logInfo('responses', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
            }
          }
        } catch (e: any) {
          await logError('responses', 'api.error', 'Responses API 失败，准备回退', { error: e?.message || String(e) }, requestId);
          // Fallback: 使用 Chat Completions 流式
          try {
            const fallbackModel = 'gpt-4o';
            const fallbackUserText = Array.isArray(input)
              ? (() => {
                  const first = input.find((i: any) => Array.isArray(i?.content));
                  const contentArr = Array.isArray(first?.content) ? first.content : [];
                  const textItem = contentArr.find((c: any) => c?.type === 'input_text');
                  return textItem?.text || '[复合输入]';
                })()
              : String(input ?? '');
            const messages = ([
              { role: 'system', content: '总是用中文回复' },
              ...historyWithoutCurrent
                .slice(-MAX_HISTORY)
                .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
                .map((m: any) => ({ role: m.role, content: String(m.content ?? '') })),
              { role: 'user', content: fallbackUserText },
            ]) as any[];

            const chatStream: any = await ai.chat.completions.create({
              model: fallbackModel,
              messages,
              stream: true,
              temperature: 0.7,
            } as any);

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: 'routing', model: fallbackModel, requestId })}\n\n`
              )
            );

            let fullContent2 = '';
            for await (const chunk of (chatStream as any)) {
              const delta = chunk.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullContent2 += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`)
                );
              }
            }

            // 落库
            try {
              await Conversation.updateOne(
                { id: conversationId, userId: user.sub },
                {
                  $push: {
                    messages: {
                      id: Date.now().toString(36),
                      role: 'assistant',
                      content: fullContent2,
                      timestamp: new Date(),
                      model: fallbackModel,
                    },
                  },
                  $set: { updatedAt: new Date() },
                }
              );
            } catch {}

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
            controller.close();

          } catch (e2: any) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e2?.message || String(e2) })}\n\n`)
            );
            controller.close();
            await logError('responses', 'fallback.error', '回退失败', { error: e2?.message || String(e2) }, requestId);
          }
        }
      },
    });

    return new Response(streamBody, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // 非流式：同样应用路由决策（统一使用 Responses API）

  const finalSettings: any = { ...(settings?.text ? { text: settings.text } : {}) };
  if (modelToUse === 'gpt-5') {
    finalSettings.reasoning = {
      ...(settings?.reasoning || {}),
      ...(routed && 'effort' in routed && routed.effort ? { effort: routed.effort } : {}),
    };
  }
  // 覆盖 verbosity
  if (!finalSettings.text) finalSettings.text = {};
  finalSettings.text.verbosity = (routed as any).verbosity || 'medium';
  let inputPayload = buildResponsesInputWithHistory(input);
  if (injectedHistoryMsg) {
    const dev = inputPayload.shift();
    inputPayload = [dev, injectedHistoryMsg, ...inputPayload];
  }
  const apiModel = modelToUse;
  const maxOutputTokens = typeof settings?.maxTokens === 'number' ? settings.maxTokens : undefined;
  const temperature = typeof settings?.temperature === 'number' ? settings.temperature : undefined;
  let content = '';
  try {

    const reqPayload: any = {
      model: apiModel,
      input: inputPayload,
      ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {}),
    };
    if (modelToUse === 'gpt-5') {
      reqPayload.reasoning = finalSettings.reasoning;
      reqPayload.text = finalSettings.text;
    } else {
      if (typeof temperature === 'number') reqPayload.temperature = temperature;
    }

    const resp = await (ai as any).responses.create(reqPayload);

    try {
      content = resp.output_text || '';
    } catch {
      content = JSON.stringify(resp);
    }
  } catch (e: any) {
    // 非流式也失败时回退到 Chat Completions
    await logError('responses', 'api.error', 'Responses API 失败，准备回退（非流式）', { error: e?.message || String(e) }, requestId);
    const fallbackModel = 'gpt-4o';
    const fallbackUserText = Array.isArray(input)
      ? (() => {
          const first = input.find((i: any) => Array.isArray(i?.content));
          const contentArr = Array.isArray(first?.content) ? first.content : [];
          const textItem = contentArr.find((c: any) => c?.type === 'input_text');
          return textItem?.text || '[复合输入]';
        })()
      : String(input ?? '');
    const messages = [
      { role: 'system', content: '总是用中文回复' },
      { role: 'user', content: fallbackUserText },
    ] as any[];
    const completion = await ai.chat.completions.create({
      model: fallbackModel,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    } as any);
    content = completion.choices?.[0]?.message?.content || '';

  }

  await Conversation.updateOne(
    { id: conversationId, userId: user.sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'assistant',
          content,
          timestamp: new Date(),
          model: modelToUse,
          metadata: searchUsed ? { searchUsed: true } : undefined,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  await logInfo('responses', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
  return Response.json({
    message: { role: 'assistant', content, model: modelToUse, metadata: searchUsed ? { searchUsed: true, sources: searchSources || undefined } : undefined },
    routing: { model: modelToUse, effort: modelToUse === 'gpt-5' ? (routed as any).effort : undefined, verbosity: (routed as any).verbosity || 'medium' },
    requestId,
  });
}


