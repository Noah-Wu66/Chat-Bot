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

  // 查找上一条助手返回的图片（用于图像连续编辑的上下文）
  const findLastAssistantImage = (): string | null => {
    try {
      for (let i = historyWithoutCurrent.length - 1; i >= 0; i--) {
        const msg = historyWithoutCurrent[i];
        if (msg && msg.role === 'assistant' && Array.isArray(msg.images) && msg.images.length > 0) {
          const last = msg.images[msg.images.length - 1];
          if (typeof last === 'string' && last) return last;
        }
      }
    } catch {}
    return null;
  };

  // 将上一张助手图片注入到本次 input 中（与用户上传图片一并作为输入）
  const augmentInputWithPrevImage = (src: string | any[], prevImageUrl: string | null): string | any[] => {
    if (!prevImageUrl) return src;

    const makeImageItem = (url: string) => ({ type: 'input_image', image_url: url });

    if (Array.isArray(src)) {
      // 找到第一个 user turn 并在其 content 中追加图片
      const arr = src.map((turn) => ({ ...turn }));
      const idx = arr.findIndex((t) => t && t.role === 'user' && Array.isArray(t.content));
      if (idx >= 0) {
        const contentArr = Array.isArray(arr[idx].content) ? arr[idx].content.slice() : [];
        // 避免重复注入
        const exists = contentArr.some((c: any) => c && c.type === 'input_image' && (c.image_url === prevImageUrl || c.image_url?.url === prevImageUrl));
        if (!exists) contentArr.push(makeImageItem(prevImageUrl));
        arr[idx] = { ...arr[idx], content: contentArr };
        return arr;
      }
      // 若未找到 user turn，则创建一个
      return [
        ...arr,
        { role: 'user', content: [{ type: 'input_text', text: '' }, makeImageItem(prevImageUrl)] },
      ];
    }

    // 纯文本 -> 变为图文数组，文本 + 上一张图片
    const text = String(src ?? '');
    return [
      {
        role: 'user',
        content: [
          { type: 'input_text', text },
          makeImageItem(prevImageUrl),
        ],
      },
    ];
  };

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

  // 统一解析 Gemini 返回的 message，抽取文本与图片
  const extractTextAndImagesFromMessage = (msg: any): { text: string; images: string[] } => {
    const textParts: string[] = [];
    const images: string[] = [];
    const seenTexts = new Set<string>();

    const pushText = (t: any) => {
      const s = typeof t === 'string' ? t : '';
      if (!s) return;
      // 全局去重，避免相同文本在不同分段（如 output_text 与 text）被重复收集
      if (!seenTexts.has(s)) {
        textParts.push(s);
        seenTexts.add(s);
      }
      // 从文本中解析可能的图片 URL（markdown/dataURL/常见扩展名）
      extractUrlImagesFromText(s, images);
    };

    const extractUrlImagesFromText = (s: string, collector: string[]) => {
      try {
        // data URL
        const dataUrlRegex = /(data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+)(?![A-Za-z0-9+/=])/g;
        let m: RegExpExecArray | null;
        while ((m = dataUrlRegex.exec(s)) !== null) {
          if (m[1]) collector.push(m[1]);
        }

        // markdown ![](url)
        const mdImgRegex = /!\[[^\]]*\]\((https?:[^)\s]+)\)/g;
        while ((m = mdImgRegex.exec(s)) !== null) {
          if (m[1]) collector.push(m[1]);
        }

        // 直接 http(s) 图片链接（常见图片扩展名）
        const httpImgRegex = /(https?:\/\/[^\s)\]\"']+\.(?:png|jpe?g|webp|gif|svg))(?![A-Za-z0-9])/gi;
        while ((m = httpImgRegex.exec(s)) !== null) {
          if (m[1]) collector.push(m[1]);
        }
      } catch {}
    };

    // 1) 直接字符串内容
    if (typeof msg?.content === 'string') {
      pushText(msg.content);
    }

    // 2) 数组内容（多模态）
    const contentArr = Array.isArray(msg?.content) ? (msg as any).content : [];
    if (Array.isArray(contentArr) && contentArr.length > 0) {
      for (const part of contentArr) {
        if (!part || typeof part !== 'object') continue;
        const type = (part as any).type || '';

        // 文本：text / output_text
        const textA = typeof (part as any).text === 'string' ? (part as any).text : '';
        const textB = typeof (part as any).output_text === 'string' ? (part as any).output_text : '';
        if (textA) pushText(textA);
        if (textB) pushText(textB);

        // 图片：标准 image_url（字符串或 { url }）
        if (type === 'image_url' || (part as any).image_url) {
          const imageUrl = typeof (part as any).image_url === 'string'
            ? (part as any).image_url
            : (part as any).image_url?.url;
          if (typeof imageUrl === 'string' && imageUrl) images.push(imageUrl);
        }

        // 图片：Gemini/Responses 风格 output_image
        if (type === 'output_image' || (part as any).output_image) {
          const p = (part as any).output_image || part;
          const url = p?.image_url || p?.url;
          const b64 = p?.b64_json || p?.base64 || p?.data;
          const mime = p?.mime || p?.mime_type || 'image/png';
          if (typeof url === 'string' && url) images.push(url);
          if (typeof b64 === 'string' && b64) images.push(`data:${mime};base64,${b64}`);
        }

        // 图片：inlineData / inline_data
        const inlineData = (part as any).inlineData || (part as any).inline_data;
        if (inlineData && typeof inlineData === 'object') {
          const data = inlineData.data || inlineData.base64 || inlineData.b64_json;
          const mime = inlineData.mimeType || inlineData.mime_type || 'image/png';
          if (typeof data === 'string' && data) images.push(`data:${mime};base64,${data}`);
        }

        // 图片：image 对象（兼容多种字段）
        const imageObj = (part as any).image;
        if (imageObj && typeof imageObj === 'object') {
          const b64 = imageObj.b64_json || imageObj.base64_data || imageObj.data || imageObj?.inline_data?.data;
          const mime = imageObj.mime || imageObj.mime_type || imageObj.mimeType || imageObj?.inline_data?.mime_type || 'image/png';
          if (typeof b64 === 'string' && b64) images.push(`data:${mime};base64,${b64}`);
          const url = typeof imageObj.url === 'string' ? imageObj.url : undefined;
          if (url) images.push(url);
        }
      }
    }

    // 3) 兼容旧字段 multi_mod_content / multiModContent
    if (!Array.isArray(msg?.content)) {
      try {
        const mm: any[] = (msg as any).multi_mod_content || (msg as any).multiModContent || [];
        if (Array.isArray(mm)) {
          for (const part of mm) {
            const text = typeof part?.text === 'string' ? part.text : '';
            if (text) pushText(text);
            const inline = part?.inlineData || part?.inline_data;
            const data = inline?.data || inline?.b64_json || inline?.base64;
            const mime = inline?.mimeType || inline?.mime_type || 'image/png';
            if (typeof data === 'string' && data) images.push(`data:${mime};base64,${data}`);
          }
        }
      } catch {}
    }

    // 4) 顶层 images 字段
    try {
      const topImages = (msg as any).images;
      if (Array.isArray(topImages)) {
        for (const it of topImages) {
          if (!it) continue;
          if (typeof it === 'string') images.push(it);
          else if (typeof it?.url === 'string') images.push(it.url);
          else if (typeof it?.b64_json === 'string') images.push(`data:image/png;base64,${it.b64_json}`);
        }
      }
    } catch {}

    const uniqueImages = Array.from(new Set(images));
    const text = textParts.filter((t, i) => textParts.indexOf(t) === i).join('\n');
    return { text, images: uniqueImages };
  };

  // 调试：分析返回消息结构，便于前端定位
  const analyzeMessageStructure = (msg: any): any => {
    const info: any = {
      contentType: typeof msg?.content,
      contentIsArray: Array.isArray(msg?.content),
      parts: 0,
      types: [] as string[],
      hasImageUrl: 0,
      hasInlineData: 0,
      hasImageObj: 0,
    };
    const arr = Array.isArray(msg?.content) ? (msg as any).content : [];
    info.parts = arr.length;
    for (const p of arr) {
      try {
        const t = (p as any)?.type;
        if (typeof t === 'string') info.types.push(t);
        if ((p as any)?.image_url) info.hasImageUrl++;
        if ((p as any)?.inlineData || (p as any)?.inline_data) info.hasInlineData++;
        if ((p as any)?.image) info.hasImageObj++;
      } catch {}
    }
    return info;
  };

  // 从用户输入里提取主要文本（用于必要时触发图像生成的兜底）
  const extractPrimaryTextFromInput = (src: string | any[]): string => {
    if (Array.isArray(src)) {
      const first = src.find((i: any) => Array.isArray(i?.content));
      const contentArr = Array.isArray(first?.content) ? first.content : [];
      const textItem = contentArr.find((c: any) => c?.type === 'input_text');
      return textItem?.text || '';
    }
    return String(src ?? '');
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

          const prevImageUrl = findLastAssistantImage();
          const augmentedInput = augmentInputWithPrevImage(input, prevImageUrl);
          const messages = buildMessagesWithHistory(augmentedInput);
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
          const parsed = extractTextAndImagesFromMessage(msg);
          try {
            const dbg = analyzeMessageStructure(msg);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'debug', stage: 'parsed', dbg, textLen: parsed.text.length, images: parsed.images.length })}\n\n`)
            );
          } catch {}
          let textContent = parsed.text;
          let images = parsed.images.slice();

          // 若未返回图片，尝试使用 Images API 进行兜底生成
          if (images.length === 0) {
            try {
              // 使用增强前或增强后的输入都可；仅使用文本部分
              const promptText = extractPrimaryTextFromInput(augmentedInput);
              if (promptText) {
                const imgResp: any = await (ai as any).images.generate({
                  model: modelToUse,
                  prompt: promptText,
                  size: '1024x1024',
                  n: 1,
                });
                const arr = (imgResp?.data || []) as any[];
                for (const item of arr) {
                  const b64 = item?.b64_json || item?.data || '';
                  const url = item?.url || '';
                  if (typeof b64 === 'string' && b64) images.push(`data:image/png;base64,${b64}`);
                  if (typeof url === 'string' && url) images.push(url);
                }
                try {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'debug', stage: 'fallback_images_generate', generated: Array.isArray(arr) ? arr.length : 0 })}\n\n`)
                  );
                } catch {}
              }
            } catch (err: any) {
              try {
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'debug', stage: 'fallback_error', message: err?.message || String(err) })}\n\n`)
                );
              } catch {}
            }
          }

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
  const prevImageUrl = findLastAssistantImage();
  const augmentedInput = augmentInputWithPrevImage(input, prevImageUrl);
  const messages = buildMessagesWithHistory(augmentedInput);
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
    const result = extractTextAndImagesFromMessage(msg);
    content = result.text;
    imagesNonStream = result.images.slice();

    // 若没有图片，使用 Images API 兜底一次
    if (!imagesNonStream || imagesNonStream.length === 0) {
      try {
        // 使用增强后的输入以获得更准确的文本摘要
        const promptText = extractPrimaryTextFromInput(augmentedInput);
        if (promptText) {
          const imgResp: any = await (ai as any).images.generate({
            model: modelToUse,
            prompt: promptText,
            size: '1024x1024',
            n: 1,
          });
          const arr = (imgResp?.data || []) as any[];
          for (const item of arr) {
            const b64 = item?.b64_json || item?.data || '';
            const url = item?.url || '';
            if (typeof b64 === 'string' && b64) imagesNonStream.push(`data:image/png;base64,${b64}`);
            if (typeof url === 'string' && url) imagesNonStream.push(url);
          }
        }
      } catch {}
    }
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



