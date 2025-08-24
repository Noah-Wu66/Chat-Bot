import { NextRequest } from 'next/server';
import { getAIClient } from '@/lib/ai';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';

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
  const normalizeModel = (m?: string) => {
    if (!m) return 'gpt-5';
    if (m === 'gpt-4o-mini') return 'gpt-4o';
    if (m === 'gpt-5-mini' || m === 'gpt-5-nano' || m === 'gpt-5-chat') return 'gpt-5';
    return m;
  };
  const modelToUse = normalizeModel(model);
  console.info('[API/responses] request.start', {
    requestId,
    userId: user.sub,
    conversationId,
    model: modelToUse,
    stream: !!stream,
    route: 'responses',
  });

  // 记录用户消息（仅文本摘要记录）
  let userContent = '';
  if (Array.isArray(input)) {
    const text = input.find((i) => i.type === 'input_text');
    userContent = text?.text || '[复合输入]';
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
          const response = await (ai as any).responses.create({
            model: modelToUse,
            input,
            ...(settings?.reasoning ? { reasoning: settings.reasoning } : {}),
            ...(settings?.text ? { text: settings.text } : {}),
            stream: true,
          });

          // SSE: routing 事件（声明最终模型）
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'routing', model: modelToUse, effort: settings?.reasoning?.effort, requestId })}\n\n`
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
              console.info('[API/responses] request.done', { requestId, conversationId, model: modelToUse });
            }
          }
        } catch (e: any) {
          console.error('[API/responses] request.error', { requestId, error: e?.message || String(e) });
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`)
          );
          controller.close();
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

  const resp = await (ai as any).responses.create({
    model: modelToUse,
    input,
    ...(settings?.reasoning ? { reasoning: settings.reasoning } : {}),
    ...(settings?.text ? { text: settings.text } : {}),
  });

  let content = '';
  try {
    content = resp.output_text || '';
  } catch {
    content = JSON.stringify(resp);
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

  console.info('[API/responses] request.done', { requestId, conversationId, model: modelToUse });
  return Response.json({
    message: { role: 'assistant', content, model: modelToUse },
    routing: { model: modelToUse, effort: settings?.reasoning?.effort },
    requestId,
  });
}


