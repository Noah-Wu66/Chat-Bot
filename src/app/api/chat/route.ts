import { NextRequest } from 'next/server';
import { getAIClient } from '@/lib/ai';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';
import { logInfo, logError } from '@/lib/logger';

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
    return m;
  };
  const modelToUse = normalizeModel(model);
  await logInfo('chat', 'request.start', '请求开始', {
    userId: user.sub,
    conversationId,
    model: modelToUse,
    stream: !!stream,
  }, requestId);

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

  const MAX_HISTORY = 30;
  const doc = await Conversation.findOne({ id: conversationId, userId: user.sub }, { messages: 1 }).lean();
  const history = Array.isArray((doc as any)?.messages) ? (doc as any).messages : [];
  const messages = ([
    { role: 'system', content: '总是用中文回复' },
    ...history
      .slice(-MAX_HISTORY)
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
      .map((m: any) => ({ role: m.role, content: String(m.content ?? '') })),
  ]) as any[];

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
            ...(typeof settings?.seed === 'number' ? { seed: settings.seed } : {}),
            stream: true,
          } as any);

          // SSE: routing 事件（声明最终模型）。Chat 路由无 reasoning.effort
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: 'routing', model: modelToUse, requestId })}\n\n`
            )
          );

          let fullContent = '';
          for await (const chunk of streamResp as AsyncIterable<any>) {
            const delta = chunk.choices?.[0]?.delta?.content || '';
            if (delta) {
              fullContent += delta;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`)
              );
            }
          }

          // 在流式结束时写入助手消息，保证历史连续
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
                  },
                },
                $set: { updatedAt: new Date() },
              }
            );
          } catch {}

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
          await logInfo('chat', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
        } catch (e: any) {
          await logError('chat', 'api.error', 'Chat Completions 流式失败，尝试非流式补偿', { error: e?.message || String(e) }, requestId);
          // 尝试以非流式补偿
          try {
            const completion = await ai.chat.completions.create({
              model: modelToUse,
              messages,
              temperature: settings?.temperature ?? 0.8,
              max_tokens: settings?.maxTokens ?? 1024,
              ...(typeof settings?.seed === 'number' ? { seed: settings.seed } : {}),
            } as any);
            const content = completion.choices?.[0]?.message?.content || '';
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'content', content })}\n\n`)
            );
            // 非流式补偿成功后写入数据库
            try {
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
            await logError('chat', 'fallback.error', '非流式补偿失败', { error: e2?.message || String(e2) }, requestId);
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

  const completion = await ai.chat.completions.create({
    model: modelToUse,
    messages,
    temperature: settings?.temperature ?? 0.8,
    max_tokens: settings?.maxTokens ?? 1024,
    top_p: settings?.topP ?? 1,
    frequency_penalty: settings?.frequencyPenalty ?? 0,
    presence_penalty: settings?.presencePenalty ?? 0,
    ...(typeof settings?.seed === 'number' ? { seed: settings.seed } : {}),
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
          model: modelToUse,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  await logInfo('chat', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
  return Response.json({
    message: { role: 'assistant', content, model: modelToUse },
    routing: { model: modelToUse },
    requestId,
  });
}


