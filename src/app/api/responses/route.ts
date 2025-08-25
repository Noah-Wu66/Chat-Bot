import { NextRequest } from 'next/server';
import { getAIClient } from '@/lib/ai';
import { routeGpt5Decision } from '@/lib/router';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';
import { logInfo, logError } from '@/lib/logger';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const body = await req.json();
  const { conversationId, input, model, settings, stream } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
  };

  const ai = getAIClient();
  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  // 新：由路由器决定最终模型（不再设置终极兜底，路由失败直接报错）
  let routed: { model: 'gpt-5' | 'gpt-5-chat'; effort?: 'minimal' | 'low' | 'medium' | 'high'; verbosity?: 'low' | 'medium' | 'high' };
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

          const response = await (ai as any).responses.create({
            model: modelToUse,
            input,
            ...(finalSettings.reasoning ? { reasoning: finalSettings.reasoning } : {}),
            ...(finalSettings.text ? { text: finalSettings.text } : {}),
            stream: true,
          });

          // SSE: routing 事件（声明最终模型）
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'routing', model: modelToUse, effort: modelToUse === 'gpt-5' ? (routed as any).effort : undefined, verbosity: (routed as any).verbosity, requestId })}\n\n`
            )
          );

          for await (const event of response) {
            if (event.type === 'response.refusal.delta') continue;
            if (event.type === 'response.output_text.delta') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content: event.delta })}\n\n`)
              );
            } else if (event.type === 'response.reasoning.delta') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'reasoning', content: event.delta })}\n\n`)
              );
            } else if (event.type === 'response.completed') {
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
            const messages = [
              { role: 'system', content: '总是用中文回复' },
              { role: 'user', content: fallbackUserText },
            ] as any[];

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

            for await (const chunk of chatStream as AsyncIterable<any>) {
              const delta = chunk.choices?.[0]?.delta?.content || '';
              if (delta) {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`)
                );
              }
            }

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
  let content = '';
  try {

    const resp = await (ai as any).responses.create({
      model: modelToUse,
      input,
      ...(finalSettings.reasoning ? { reasoning: finalSettings.reasoning } : {}),
      ...(finalSettings.text ? { text: finalSettings.text } : {}),
    });

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
          model,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  await logInfo('responses', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
  return Response.json({
    message: { role: 'assistant', content, model: modelToUse },
    routing: { model: modelToUse, effort: modelToUse === 'gpt-5' ? (routed as any).effort : undefined, verbosity: (routed as any).verbosity || 'medium' },
    requestId,
  });
}


