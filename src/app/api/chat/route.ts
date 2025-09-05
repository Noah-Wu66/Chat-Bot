import { NextRequest } from 'next/server';
import { getAIClient } from '@/lib/ai';
import { performWebSearchSummary } from '@/lib/router';
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
  const { conversationId, message, model, settings, stream, webSearch } = body as {
    conversationId: string;
    message: { content: string; images?: string[] };
    model: string;
    settings: any;
    stream?: boolean;
    webSearch?: boolean;
  };

  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const normalizeModel = (m?: string) => {
    if (!m) return 'openai/gpt-5';
    if (m === 'gpt-5') return 'openai/gpt-5';
    if (m === 'gemini-image') return 'google/gemini-2.5-flash-image-preview';
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
  let messages = ([
    { role: 'system', content: '总是用中文回复' },
    ...history
      .slice(-MAX_HISTORY)
      .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
      .map((m: any) => ({ role: m.role, content: String(m.content ?? '') })),
  ]) as any[];

  // 如果是 Gemini 图像模型：将“当前用户消息”改为多模态 content（文本 + 图片）
  const isGeminiImageModel = modelToUse === 'google/gemini-2.5-flash-image-preview';
  if (isGeminiImageModel) {
    const hasImages = Array.isArray(message?.images) && message.images.length > 0;
    if (hasImages || (typeof message?.content === 'string' && message.content.trim().length > 0)) {
      const lastIndex = messages.length - 1;
      if (lastIndex >= 0 && messages[lastIndex]?.role === 'user') {
        const parts: any[] = [];
        if (typeof message?.content === 'string' && message.content.trim()) {
          parts.push({ type: 'text', text: message.content });
        }
        (message.images || []).forEach((img) => {
          parts.push({ type: 'image_url', image_url: { url: img } });
        });
        if (parts.length > 0) {
          messages[lastIndex] = { role: 'user', content: parts } as any;
        }
      }
    }
  }

  // 可选：联网搜索（仅由用户开关决定）
  let searchUsed = false;
  let searchSources: any[] | null = null;
  if (webSearch) {
    const webSize = (typeof settings?.web?.size === 'number' ? settings.web.size : 10) as number;
    const query = String(message?.content || '');
    const { markdown, used, sources } = await performWebSearchSummary(query, webSize);
    if (used && markdown) {
      messages = [
        { role: 'system', content: '总是用中文回复' },
        { role: 'system', content: `以下为联网搜索到的材料（供参考，不保证准确）：\n\n${markdown}` },
        ...history
          .slice(-MAX_HISTORY)
          .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system'))
          .map((m: any) => ({ role: m.role, content: String(m.content ?? '') })),
      ] as any[];
      searchUsed = true;
      searchSources = Array.isArray(sources) ? sources : null;
    }
  }

  // Chat Completions 标准调用
  if (stream) {
    // 对于 Gemini 图像模型，采用一次性返回（非流式调用 + SSE 包装），以便拿到 message.images
    if (isGeminiImageModel) {
      const encoder = new TextEncoder();
      const streamBody = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'start', requestId, route: 'chat', model: modelToUse })}\n\n`)
            );

            // 调用非流式，携带 modalities 以启用图像输出
            const completion: any = await ai.chat.completions.create({
              model: modelToUse,
              messages,
              temperature: settings?.temperature ?? 0.8,
              max_tokens: settings?.maxTokens ?? 1024,
              top_p: settings?.topP ?? 1,
              frequency_penalty: settings?.frequencyPenalty ?? 0,
              presence_penalty: settings?.presencePenalty ?? 0,
              ...(typeof settings?.seed === 'number' ? { seed: settings.seed } : {}),
              modalities: ['image', 'text'],
            } as any);

            // 不再发送 routing 事件

            const content = completion?.choices?.[0]?.message?.content || '';
            const images: string[] = Array.isArray(completion?.choices?.[0]?.message?.images)
              ? (completion.choices[0].message.images as any[])
                  .map((im: any) => im?.image_url?.url)
                  .filter((u: any) => typeof u === 'string' && u)
              : [];

            if (content) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content })}\n\n`)
              );
            }
            if (images.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'images', images })}\n\n`)
              );
            }

            // 保存助手消息（包含 images）
            try {
              await Conversation.updateOne(
                { id: conversationId, userId: user.sub },
                {
                  $push: {
                    messages: {
                      id: Date.now().toString(36),
                      role: 'assistant',
                      content: content || '',
                      timestamp: new Date(),
                      model: modelToUse,
                      images: images.length > 0 ? images : undefined,
                      metadata: searchUsed ? { searchUsed: true, sources: searchSources || undefined } : undefined,
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
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message || String(e) })}\n\n`)
            );
            controller.close();
            await logError('chat', 'api.error', 'Gemini 图像模型非流式失败', { error: e?.message || String(e) }, requestId);
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

          // 若已使用联网搜索，先通知前端
          if (searchUsed) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'search', used: true })}\n\n`)
            );
            if (Array.isArray(searchSources) && searchSources.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'search_sources', sources: searchSources })}\n\n`)
              );
            }
          }

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
            ...(isGeminiImageModel ? { modalities: ['image', 'text'] } : {}),
          } as any);

          // 无路由系统，不发送 routing 事件

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
                    metadata: searchUsed ? { searchUsed: true, sources: searchSources || undefined } : undefined,
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
          await logError('chat', 'api.error', 'Chat Completions 流式失败', { error: e?.message || String(e) }, requestId);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message || String(e) })}\n\n`)
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
          metadata: (typeof searchUsed !== 'undefined' && searchUsed) ? { searchUsed: true } : undefined,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  await logInfo('chat', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
  return Response.json({
    message: { role: 'assistant', content, model: modelToUse, metadata: (typeof searchUsed !== 'undefined' && searchUsed) ? { searchUsed: true, sources: searchSources || undefined } : undefined },
    requestId,
  });
}


