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
  await logInfo('chat', 'model.normalized', '归一化模型', { inputModel: model, modelToUse }, requestId);

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
    await logInfo('chat', 'gemini.prepare', 'Gemini 图像输入整理完成', {
      hasImages: Array.isArray(message?.images) && message.images.length > 0,
      imageCount: Array.isArray(message?.images) ? message.images.length : 0,
      textLength: typeof message?.content === 'string' ? message.content.length : 0,
    }, requestId);
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

            // 使用 Responses API 以支持图像输出（modalities: ['image', 'text']）
            const toInputImage = (img: string): any => {
              if (typeof img === 'string' && img.startsWith('data:')) {
                const match = img.match(/^data:([^;]+);base64,(.*)$/);
                if (match) {
                  return { type: 'input_image', image_data: match[2], mime_type: match[1] } as any;
                }
              }
              return { type: 'input_image', image_url: img } as any;
            };
            const parts: any[] = [];
            if (typeof message?.content === 'string' && message.content.trim()) {
              parts.push({ type: 'input_text', text: message.content.trim() });
            }
            (message.images || []).forEach((img) => parts.push(toInputImage(img)));

            const inputPayload: any[] = [
              { role: 'developer', content: [{ type: 'input_text', text: '总是用中文回复' }] },
              { role: 'user', content: parts },
            ];

            const req: any = {
              model: modelToUse,
              input: inputPayload,
              stream: true,
              modalities: ['image', 'text'],
              ...(typeof settings?.temperature === 'number' ? { temperature: settings.temperature } : {}),
              ...(typeof settings?.maxTokens === 'number' ? { max_output_tokens: settings.maxTokens } : {}),
            };

            const response = await (ai as any).responses.create(req);

            let fullContent = '';
            const imageUrls: string[] = [];

            for await (const event of response as AsyncIterable<any>) {
              if (event.type === 'response.output_text.delta') {
                const delta = event.delta || '';
                if (delta) {
                  fullContent += delta;
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`)
                  );
                }
              } else if (event.type === 'response.output_image.delta') {
                // 兼容多种结构：image_url 或 base64 数据
                try {
                  const d = (event as any).delta || {};
                  let url: string | null = null;
                  if (typeof d?.image_url === 'string') url = d.image_url;
                  if (!url && typeof d?.url === 'string') url = d.url;
                  if (!url && d?.image_url?.url) url = d.image_url.url;
                  if (!url && (d?.b64_json || d?.data)) {
                    const mime = d?.mime_type || 'image/png';
                    const b64 = d?.b64_json || d?.data;
                    url = `data:${mime};base64,${b64}`;
                  }
                  if (url) {
                    imageUrls.push(url);
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ type: 'images', images: [url] })}\n\n`)
                    );
                  }
                } catch {}
              } else if (event.type === 'response.completed') {
                // 写入 DB 并收尾
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
                          images: imageUrls.length > 0 ? imageUrls : undefined,
                          metadata: searchUsed ? { searchUsed: true, sources: searchSources || undefined } : undefined,
                        },
                      },
                      $set: { updatedAt: new Date() },
                    }
                  );
                } catch {}

                await logInfo('chat', 'gemini.result', 'Gemini 返回结果', { imageCount: imageUrls.length, hasText: !!fullContent }, requestId);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
                controller.close();
                await logInfo('chat', 'request.done', '请求完成', { conversationId, model: modelToUse }, requestId);
              }
            }
          } catch (e: any) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message || String(e) })}\n\n`)
            );
            controller.close();
            await logError('chat', 'api.error', 'Gemini 图像模型流式失败', { error: e?.message || String(e) }, requestId);
          }
        },
      });

      return new Response(streamBody, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Request-Id': requestId,
          'X-Model': modelToUse,
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
        'X-Request-Id': requestId,
        'X-Model': modelToUse,
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
  return Response.json(
    {
      message: { role: 'assistant', content, model: modelToUse, metadata: (typeof searchUsed !== 'undefined' && searchUsed) ? { searchUsed: true, sources: searchSources || undefined } : undefined },
      requestId,
    },
    { headers: { 'X-Request-Id': requestId, 'X-Model': modelToUse } }
  );
}


