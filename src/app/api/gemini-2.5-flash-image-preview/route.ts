// 使用标准 Request 类型，避免对 next/server 类型的依赖
import { getAIClient } from '@/lib/ai';
import { performWebSearchSummary } from '@/lib/router';
import { getConversationModel } from '@/lib/models/Conversation';
import { getCurrentUser } from '@/app/actions/auth';

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
  const modelToUse = 'gemini-2.5-flash-image-preview' as const;

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

  // 构建历史文本
  const MAX_HISTORY = 30;
  const doc = await Conversation.findOne({ id: conversationId, userId: user.sub }, { messages: 1 }).lean();
  const fullHistory: any[] = Array.isArray((doc as any)?.messages) ? (doc as any).messages : [];
  const historyWithoutCurrent = fullHistory.length > 0 ? fullHistory.slice(0, -1) : [];
  const buildHistoryText = (list: any[]): string => {
    const items = list.slice(-MAX_HISTORY).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'));
    return items.map((m: any) => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content ?? '')}`).join('\n');
  };
  const historyText = buildHistoryText(historyWithoutCurrent);

  // 将 input 转换为 ChatCompletions 的 messages
  type CCPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
  type CCMessage = { role: 'system' | 'user' | 'assistant'; content: CCPart[] | string };

  const toCCPart = (item: any): CCPart | null => {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'input_text' && typeof item.text === 'string') {
      return { type: 'text', text: item.text };
    }
    if (item.type === 'input_image') {
      const mime = typeof item.mime_type === 'string' && item.mime_type ? item.mime_type : 'image/png';
      if (typeof item.image_data === 'string' && item.image_data) {
        const url = `data:${mime};base64,${item.image_data}`;
        return { type: 'image_url', image_url: { url } };
      }
      if (typeof item.image_url === 'string' && item.image_url) {
        return { type: 'image_url', image_url: { url: item.image_url } };
      }
    }
    return null;
  };

  const buildMessagesWithHistory = (src: string | any[]): CCMessage[] => {
    const messages: CCMessage[] = [];
    messages.push({ role: 'system', content: [{ type: 'text', text: '总是用中文回复' }] as CCPart[] });
    if (historyText) {
      messages.push({ role: 'user', content: [{ type: 'text', text: `以下是对话历史（供参考）：\n${historyText}` } as CCPart] });
    }
    if (Array.isArray(src)) {
      for (const turn of src) {
        const role = turn?.role === 'assistant' ? 'assistant' : 'user';
        const parts = Array.isArray(turn?.content) ? turn.content.map(toCCPart).filter(Boolean) as CCPart[] : [];
        if (parts.length > 0) messages.push({ role, content: parts });
      }
    } else {
      const text = String(src ?? '');
      messages.push({ role: 'user', content: [{ type: 'text', text } as CCPart] });
    }
    return messages;
  };

  // 可选：联网搜索
  let searchUsed = false;
  let injectedHistoryMsg: any | null = null;
  let searchSources: any[] | null = null;
  if (webSearch) {
    const currText = Array.isArray(input)
      ? (() => {
          const first = input.find((i: any) => Array.isArray(i?.content));
          const contentArr = Array.isArray(first?.content) ? first.content : [];
          const textItem = contentArr.find((c: any) => c?.type === 'input_text');
          return textItem?.text || '';
        })()
      : String(input ?? '');
    const webSize = (typeof settings?.web?.size === 'number' ? settings.web.size : 10) as number;
    const { markdown, used, sources } = await performWebSearchSummary(currText, webSize);
    if (used && markdown) {
      injectedHistoryMsg = { role: 'system', content: [{ type: 'input_text', text: `以下为联网搜索到的材料（供参考，不保证准确）：\n\n${markdown}` }] } as any;
      searchUsed = true;
      searchSources = Array.isArray(sources) ? sources : null;
    }
  }

  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'start', requestId, route: 'chat.completions', model: modelToUse })}\n\n`)
          );

          const messages = buildMessagesWithHistory(input);
          if (injectedHistoryMsg) {
            const sysIdx = messages.findIndex((m) => m.role === 'system');
            const injected = {
              role: 'system' as const,
              content: [{ type: 'text', text: (injectedHistoryMsg?.content?.[0]?.text as string) || '' } as CCPart],
            };
            if (sysIdx >= 0) messages.splice(sysIdx + 1, 0, injected);
            else messages.unshift(injected);
          }

          const temperature = typeof settings?.temperature === 'number' ? settings.temperature : 0.7;

          const resp: any = await (ai as any).chat.completions.create({
            model: modelToUse,
            messages,
            modalities: ['text', 'image'],
            temperature,
          });

          if (searchUsed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'search', used: true })}\n\n`));
            if (Array.isArray(searchSources) && searchSources.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'search_sources', sources: searchSources })}\n\n`)
              );
            }
          }

          const choice = resp?.choices?.[0];
          const msg = choice?.message || {};
          let textContent = '';
          try {
            textContent = typeof msg.content === 'string' ? msg.content : '';
          } catch {}

          const images: string[] = [];

          // 1) 新增：当 message.content 为数组时解析多模态输出
          try {
            const contentArr = Array.isArray((msg as any).content) ? (msg as any).content : [];
            if (Array.isArray(contentArr) && contentArr.length > 0) {
              for (const part of contentArr) {
                if (!part || typeof part !== 'object') continue;
                const type = (part as any).type || '';
                // 文本
                const textA = typeof (part as any).text === 'string' ? (part as any).text : '';
                const textB = typeof (part as any).output_text === 'string' ? (part as any).output_text : '';
                if (textA || textB) {
                  const t = textA || textB;
                  textContent += (textContent ? '\n' : '') + t;
                }
                // image_url: 可能是字符串或 { url }
                if (type === 'image_url' || (part as any).image_url) {
                  const imageUrl = typeof (part as any).image_url === 'string'
                    ? (part as any).image_url
                    : (part as any).image_url?.url;
                  if (typeof imageUrl === 'string' && imageUrl) {
                    images.push(imageUrl);
                  }
                }
                // inline_data / inlineData: { data, mime_type|mimeType }
                const inlineSnake = (part as any).inline_data;
                const inlineCamel = (part as any).inlineData;
                const inline = inlineSnake || inlineCamel;
                if (inline && typeof inline === 'object') {
                  const data = inline.data;
                  const mime = inline.mime_type || inline.mimeType || 'image/png';
                  if (typeof data === 'string' && data) {
                    images.push(`data:${mime};base64,${data}`);
                  }
                }
                // image.b64_json 兼容（OpenAI 风格）
                const imageObj = (part as any).image;
                if (imageObj && typeof imageObj === 'object') {
                  const b64 = imageObj.b64_json || imageObj.base64_data || imageObj.data;
                  const mime = imageObj.mime || imageObj.mime_type || imageObj.mimeType || 'image/png';
                  if (typeof b64 === 'string' && b64) {
                    images.push(`data:${mime};base64,${b64}`);
                  }
                }
              }
            }
          } catch {}

          // 2) 兼容：multi_mod_content/multiModContent（旧字段）
          try {
            const mm: any[] = (msg as any).multi_mod_content || (msg as any).multiModContent || [];
            if (Array.isArray(mm)) {
              for (const part of mm) {
                const hasSnake = part && typeof part === 'object' && part.inline_data;
                const hasCamel = part && typeof part === 'object' && part.inlineData;
                const data = hasSnake ? part.inline_data?.data : hasCamel ? part.inlineData?.data : undefined;
                const mime = hasSnake ? (part.inline_data?.mime_type || 'image/png') : hasCamel ? (part.inlineData?.mimeType || 'image/png') : 'image/png';
                const text = typeof part?.text === 'string' ? part.text : '';
                if (text) textContent += (textContent ? '\n' : '') + text;
                if (typeof data === 'string' && data) {
                  images.push(`data:${mime};base64,${data}`);
                }
              }
            }
          } catch {}

          if (textContent) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: textContent })}\n\n`));
          }
          if (images.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'images', images })}\n\n`));
          }

          try {
            await Conversation.updateOne(
              { id: conversationId, userId: user.sub },
              {
                $push: {
                  messages: {
                    id: Date.now().toString(36),
                    role: 'assistant',
                    content: textContent || (msg?.content || ''),
                    images: images.length > 0 ? images : undefined,
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
        } catch (e: any) {
          console.error('[Gemini] 流式请求失败:', e?.message || String(e));
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

  // 非流式
  const messages = buildMessagesWithHistory(input);
  if (injectedHistoryMsg) {
    const sysIdx = messages.findIndex((m) => m.role === 'system');
    const injected = {
      role: 'system' as const,
      content: [{ type: 'text', text: (injectedHistoryMsg?.content?.[0]?.text as string) || '' } as CCPart],
    };
    if (sysIdx >= 0) messages.splice(sysIdx + 1, 0, injected);
    else messages.unshift(injected);
  }
  const temperature = typeof settings?.temperature === 'number' ? settings.temperature : 0.7;
  let content = '';
  let imagesNonStream: string[] = [];
  try {
    const resp: any = await (ai as any).chat.completions.create({
      model: modelToUse,
      messages,
      modalities: ['text', 'image'],
      temperature,
    });
    const choice = resp?.choices?.[0];
    const msg = choice?.message || {};
    content = typeof msg?.content === 'string' ? msg.content : '';

    // 1) 当 message.content 为数组
    try {
      const contentArr = Array.isArray((msg as any).content) ? (msg as any).content : [];
      if (Array.isArray(contentArr) && contentArr.length > 0) {
        for (const part of contentArr) {
          if (!part || typeof part !== 'object') continue;
          const type = (part as any).type || '';
          const textA = typeof (part as any).text === 'string' ? (part as any).text : '';
          const textB = typeof (part as any).output_text === 'string' ? (part as any).output_text : '';
          if (textA || textB) {
            const t = textA || textB;
            content += (content ? '\n' : '') + t;
          }
          if (type === 'image_url' || (part as any).image_url) {
            const imageUrl = typeof (part as any).image_url === 'string' ? (part as any).image_url : (part as any).image_url?.url;
            if (typeof imageUrl === 'string' && imageUrl) {
              imagesNonStream.push(imageUrl);
            }
          }
          const inlineSnake = (part as any).inline_data;
          const inlineCamel = (part as any).inlineData;
          const inline = inlineSnake || inlineCamel;
          if (inline && typeof inline === 'object') {
            const data = inline.data;
            const mime = inline.mime_type || inline.mimeType || 'image/png';
            if (typeof data === 'string' && data) {
              imagesNonStream.push(`data:${mime};base64,${data}`);
            }
          }
          const imageObj = (part as any).image;
          if (imageObj && typeof imageObj === 'object') {
            const b64 = imageObj.b64_json || imageObj.base64_data || imageObj.data;
            const mime = imageObj.mime || imageObj.mime_type || imageObj.mimeType || 'image/png';
            if (typeof b64 === 'string' && b64) {
              imagesNonStream.push(`data:${mime};base64,${b64}`);
            }
          }
        }
      }
    } catch {}

    // 2) 兼容旧字段 multi_mod_content/multiModContent
    try {
      const mm: any[] = (msg as any).multi_mod_content || (msg as any).multiModContent || [];
      if (Array.isArray(mm)) {
        for (const part of mm) {
          const hasSnake = part && typeof part === 'object' && part.inline_data;
          const hasCamel = part && typeof part === 'object' && part.inlineData;
          const data = hasSnake ? part.inline_data?.data : hasCamel ? part.inlineData?.data : undefined;
          const mime = hasSnake ? (part.inline_data?.mime_type || 'image/png') : hasCamel ? (part.inlineData?.mimeType || 'image/png') : 'image/png';
          const text = typeof part?.text === 'string' ? part.text : '';
          if (text) content += (content ? '\n' : '') + text;
          if (typeof data === 'string' && data) {
            imagesNonStream.push(`data:${mime};base64,${data}`);
          }
        }
      }
    } catch {}
  } catch (e: any) {
    console.error('[Gemini] 非流式请求失败:', e?.message || String(e));
    throw e;
  }

  await Conversation.updateOne(
    { id: conversationId, userId: user.sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'assistant',
          content,
          images: imagesNonStream.length > 0 ? imagesNonStream : undefined,
          timestamp: new Date(),
          model: modelToUse,
          metadata: searchUsed ? { searchUsed: true } : undefined,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  return Response.json(
    {
      message: { role: 'assistant', content, model: modelToUse, images: imagesNonStream.length > 0 ? imagesNonStream : undefined, metadata: searchUsed ? { searchUsed: true, sources: searchSources || undefined } : undefined },
      requestId,
    },
    { headers: { 'X-Request-Id': requestId, 'X-Model': modelToUse } }
  );
}



