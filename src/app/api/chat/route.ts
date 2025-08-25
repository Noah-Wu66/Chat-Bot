import { NextRequest } from 'next/server';
import { getAIClient } from '@/lib/ai';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }

  const body = await req.json();
  const { conversationId, message, model, settings, stream } = body as {
    conversationId: string;
    message: { content: string; images?: string[] };
    model: string;
    settings: any;
    stream?: boolean;
  };

  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const normalizeModel = (m?: string) => {
    if (!m) return 'gpt-4o';
    if (m === 'gpt-4o-mini') return 'gpt-4o';
    if (m === 'gpt-5-mini' || m === 'gpt-5-nano' || m === 'gpt-5-chat') return 'gpt-5';
    return m;
  };
  const modelToUse = normalizeModel(model);
  console.info('[API/chat] request.start', {
    requestId,
    userId: user.sub,
    conversationId,
    model: modelToUse,
    stream: !!stream,
    route: 'chat',
  });

  const ai = getAIClient();

  // 记录消息到数据库（用户消息）
  const Conversation = await getConversationModel();
  await Conversation.updateOne(
    { id: conversationId, userId: user.sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'user',
          content: message.content,
          timestamp: new Date(),
          model,
          images: message.images || [],
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  const messages = [
    { role: 'system', content: '总是用中文回复' },
    { role: 'user', content: message.content },
  ] as any[];

  // Chat Completions 标准调用
  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // SSE: start 事件
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'start', requestId, route: 'chat', model: modelToUse })}\n\n`
            )
          );

          const streamResp: any = await ai.chat.completions.create({
            model: modelToUse,
            messages,
            temperature: settings?.temperature ?? 0.8,
            max_tokens: settings?.maxTokens ?? 1024,
            top_p: settings?.topP ?? 1,
            frequency_penalty: settings?.frequencyPenalty ?? 0,
            presence_penalty: settings?.presencePenalty ?? 0,
            stream: true,
          } as any);

          // SSE: routing 事件（声明最终模型）。Chat 路由无 reasoning.effort
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'routing', model: modelToUse, requestId })}\n\n`
            )
          );

          for await (const chunk of streamResp as AsyncIterable<any>) {
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`)
              );
            }
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
          console.info('[API/chat] request.done', { requestId, conversationId, model: modelToUse });
        } catch (e: any) {
          console.error('[API/chat] request.error', { requestId, error: e?.message || String(e) });
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

  const completion = await ai.chat.completions.create({
    model: modelToUse,
    messages,
    temperature: settings?.temperature ?? 0.8,
    max_tokens: settings?.maxTokens ?? 1024,
    top_p: settings?.topP ?? 1,
    frequency_penalty: settings?.frequencyPenalty ?? 0,
    presence_penalty: settings?.presencePenalty ?? 0,
  } as any);

  const content = completion.choices?.[0]?.message?.content || '';

  // 保存助手消息
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

  console.info('[API/chat] request.done', { requestId, conversationId, model: modelToUse });
  return Response.json({
    message: { role: 'assistant', content, model: modelToUse },
    routing: { model: modelToUse },
    requestId,
  });
}


