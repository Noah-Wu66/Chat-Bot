import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getUserModel } from '@/lib/models/User';
import { getConversationModel } from '@/lib/models/Conversation';

export const runtime = 'nodejs';

function getArkKey(): string | null {
  try {
    return process.env.ARK_API_KEY || null;
  } catch {
    return null;
  }
}

async function getCurrentUser() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) return null;
  const payload = verifyJWT(token);
  if (!payload) return null;
  try {
    const User = await getUserModel();
    const u = await User.findOne({ id: payload.sub }).lean();
    if (!u) return null;
    if ((u as any).isBanned) return { ...payload, isBanned: true } as any;
    return { ...payload, isBanned: Boolean((u as any).isBanned) } as any;
  } catch {
    return payload as any;
  }
}

// 提取文本与图片 URL（仅 http/https，用于 Ark 图生图）
function extractTextAndImageUrls(input: string | any[]): { text: string; imageUrls: string[] } {
  if (Array.isArray(input)) {
    const first = input.find((i: any) => Array.isArray(i?.content));
    const contentArr = Array.isArray(first?.content) ? first.content : [];
    const textItem = contentArr.find((c: any) => c?.type === 'input_text');
    const text = textItem?.text || '';
    const urls: string[] = [];
    for (const it of contentArr) {
      if (it && it.type === 'input_image') {
        const maybe = typeof it.image_url === 'string' ? it.image_url : (it?.image_url?.url || '');
        if (typeof maybe === 'string' && /^https?:\/\//i.test(maybe)) urls.push(maybe);
      }
    }
    return { text, imageUrls: urls };
  }
  return { text: String(input ?? ''), imageUrls: [] };
}

// 解析 Ark 返回结构中的图片 URL/数据
function parseArkImages(respJson: any): { urls: string[]; b64: string[] } {
  const urls: string[] = [];
  const b64: string[] = [];
  try {
    const data = (respJson && (respJson.data || respJson.images || respJson.output || respJson.result)) ?? respJson?.data;
    const list: any[] = Array.isArray(data) ? data : (Array.isArray(respJson?.data?.images) ? respJson.data.images : []);
    if (Array.isArray(list)) {
      for (const it of list) {
        const u = it?.url || it?.image_url || it?.href;
        const b = it?.b64_json || it?.base64 || it?.data;
        if (typeof u === 'string' && u) urls.push(u);
        if (typeof b === 'string' && b) b64.push(b);
      }
    } else {
      // 兼容形如 { url: ... } 或 { images: [ ... ] }
      const u = data?.url || data?.image_url;
      if (typeof u === 'string' && u) urls.push(u);
      const b = data?.b64_json || data?.base64 || data?.data;
      if (typeof b === 'string' && b) b64.push(b);
    }
  } catch {}
  return { urls: Array.from(new Set(urls)), b64 };
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  if ((user as any).isBanned) return new Response(JSON.stringify({ error: '账户已被封禁' }), { status: 403 });

  const arkKey = getArkKey();
  if (!arkKey) return new Response(JSON.stringify({ error: '缺少 ARK_API_KEY' }), { status: 500 });

  const body = await req.json();
  const { conversationId, input, model, settings, stream, regenerate } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
    regenerate?: boolean;
  };

  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const modelToUse = 'seedream-4-0' as const;
  try {
    console.log('[Seedream][route] start', { requestId, stream: !!stream, model: modelToUse });
  } catch {}

  // 记录用户消息（仅文本）
  const { text: userText } = extractTextAndImageUrls(input);
  if (!regenerate) {
    await Conversation.updateOne(
      { id: conversationId, userId: (user as any).sub },
      {
        $push: {
          messages: {
            id: Date.now().toString(36),
            role: 'user',
            content: userText,
            timestamp: new Date(),
            model,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );
  }

  // 组装 Ark 请求体
  const { text: prompt, imageUrls } = extractTextAndImageUrls(input);
  const sd = settings?.seedream;
  if (!sd || typeof sd !== 'object') {
    return new Response(JSON.stringify({ error: '缺少 settings.seedream' }), { status: 400 });
  }
  if (!(['1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'] as const).includes((sd as any).aspectRatio)) {
    return new Response(JSON.stringify({ error: '缺少或非法参数：seedream.aspectRatio' }), { status: 400 });
  }
  const aspect: '1:1' | '4:3' | '3:4' | '16:9' | '9:16' | '3:2' | '2:3' | '21:9' = sd.aspectRatio as any;
  if (!(['auto','on','off'] as const).includes((sd as any).sequentialImageGeneration)) {
    return new Response(JSON.stringify({ error: '缺少或非法参数：seedream.sequentialImageGeneration' }), { status: 400 });
  }
  const seqGen: 'auto' | 'on' | 'off' = sd.sequentialImageGeneration as any;
  if (!(typeof (sd as any).maxImages === 'number' && (sd as any).maxImages > 0)) {
    return new Response(JSON.stringify({ error: '缺少或非法参数：seedream.maxImages' }), { status: 400 });
  }
  const maxImages: number = Math.floor((sd as any).maxImages);
  if (!(['url','b64_json'] as const).includes((sd as any).responseFormat)) {
    return new Response(JSON.stringify({ error: '缺少或非法参数：seedream.responseFormat' }), { status: 400 });
  }
  const responseFormat: 'url' | 'b64_json' = sd.responseFormat as any;
  const hasWatermark = typeof (sd as any).watermark === 'boolean';

  // 宽高比到像素尺寸映射
  const aspectToSize: Record<typeof aspect, { width: number; height: number }> = {
    '1:1':   { width: 2048, height: 2048 },
    '4:3':   { width: 2304, height: 1728 },
    '3:4':   { width: 1728, height: 2304 },
    '16:9':  { width: 2560, height: 1440 },
    '9:16':  { width: 1440, height: 2560 },
    '3:2':   { width: 2496, height: 1664 },
    '2:3':   { width: 1664, height: 2496 },
    '21:9':  { width: 3024, height: 1296 },
  } as const;
  const imageSize = aspectToSize[aspect];
  // 要求前端显式提供 size，支持两种形式：
  // 1) "WIDTHxHEIGHT" 明确像素；2) "1K/2K/4K/...K" 基于宽高比的基准像素等比缩放
  const sizeRaw = typeof (sd as any).size === 'string' ? (sd as any).size.trim() : '';
  if (!sizeRaw) {
    return new Response(JSON.stringify({ error: '缺少参数：seedream.size' }), { status: 400 });
  }
  let sizeString: string = '';
  if (/^\d{2,5}x\d{2,5}$/i.test(sizeRaw)) {
    sizeString = sizeRaw;
  } else {
    const m = sizeRaw.toLowerCase().match(/^(\d+)k$/);
    if (!m) {
      return new Response(JSON.stringify({ error: '非法参数：seedream.size（需为 WIDTHxHEIGHT 或 N K）' }), { status: 400 });
    }
    const k = parseInt(m[1], 10);
    const base = { w: imageSize.width, h: imageSize.height };
    const factor = k / 2; // 2K 作为 1x 基准，则 N K => (N/2)x
    const w = Math.max(64, Math.round(base.w * factor));
    const h = Math.max(64, Math.round(base.h * factor));
    sizeString = `${w}x${h}`;
  }

  const arkPayload: any = {
    model: 'doubao-seedream-4-0-250828',
    prompt: `${prompt || ''}`.trim(),
    aspect_ratio: aspect,
    sequential_image_generation: seqGen,
    sequential_image_generation_options: { max_images: maxImages },
    response_format: responseFormat,
    // 提交像素尺寸（与文档对齐，使用字符串 WIDTHxHEIGHT 形式）
    size: sizeString,
    // 统一非流式从 Ark 拉取，由路由转发为 SSE
    stream: false,
  };
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    arkPayload.image = imageUrls;
  }
  if (hasWatermark) {
    arkPayload.watermark = (sd as any).watermark;
  }

  const arkEndpoint = 'https://ark.cn-beijing.volces.com/api/v3/images/generations';

  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'start', requestId, route: 'ark.images', model: modelToUse })}\n\n`)
          );
          try {
            console.log('[Seedream][route] fetch ark (stream)', {
              requestId,
              endpoint: arkEndpoint,
              aspect,
              size: sizeString,
              responseFormat,
              seqGen,
              maxImages,
              promptLen: (prompt || '').length,
              inputImages: Array.isArray(imageUrls) ? imageUrls.length : 0,
            });
          } catch {}

          const resp = await fetch(arkEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${arkKey}`,
            },
            body: JSON.stringify(arkPayload),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            try { console.error('[Seedream][route] ark http error', { requestId, status: resp.status, contentType: resp.headers.get('content-type'), bodyPreview: errText?.slice?.(0, 400) }); } catch {}
            throw new Error(errText || 'Ark 请求失败');
          }

          try { console.log('[Seedream][route] ark http ok', { requestId, status: resp.status, contentType: resp.headers.get('content-type') }); } catch {}
          const json = await resp.json();
          try { console.log('[Seedream][route] ark json received', { requestId, hasData: !!json, keys: json ? Object.keys(json).slice(0, 8) : [] }); } catch {}
          const { urls, b64 } = parseArkImages(json);
          // 将 URL 与 base64 一并下发为 images，前端统一展示
          const images: string[] = [];
          if (Array.isArray(urls)) {
            for (const u of urls) {
              if (typeof u === 'string' && u) images.push(u);
            }
          }
          if (Array.isArray(b64)) {
            for (const b of b64) {
              if (typeof b === 'string' && b) images.push(`data:image/png;base64,${b}`);
            }
          }
          try { console.log('[Seedream][route] parsed images', { requestId, urls: (urls || []).length, b64: (b64 || []).length, images: images.length }); } catch {}

          if (images.length === 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: '生成失败\n结果包含敏感内容，请尝试重新编辑。' })}\n\n`)
            );
            controller.close();
            return;
          }

          try { console.log('[Seedream][route] send images event', { requestId, count: images.length, first: images[0] }); } catch {}
          // 兼容 Ark 官方流式事件：逐张发出 partial 事件以改善前端体验
          for (let i = 0; i < images.length; i++) {
            const partial = { type: 'image_generation.partial_succeeded', image_index: i, url: images[i] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(partial)}\n\n`));
          }
          // 同时下发聚合 images 事件，便于前端一次性渲染
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'images', images })}\n\n`));

          try {
            await Conversation.updateOne(
              { id: conversationId, userId: (user as any).sub },
              {
                $push: {
                  messages: {
                    id: Date.now().toString(36),
                    role: 'assistant',
                    content: '',
                    images,
                    timestamp: new Date(),
                    model: modelToUse,
                  },
                },
                $set: { updatedAt: new Date() },
              }
            );
          } catch {}

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          try { console.log('[Seedream][route] send done event', { requestId }); } catch {}
          controller.close();
        } catch (e: any) {
          try { console.error('[Seedream][route] stream error', { requestId, message: e?.message || String(e) }); } catch {}
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
  try {
    console.log('[Seedream][route] fetch ark (non-stream)', {
      requestId,
      endpoint: arkEndpoint,
      aspect,
      size: sizeString,
      responseFormat,
      seqGen,
      maxImages,
      promptLen: (prompt || '').length,
      inputImages: Array.isArray(imageUrls) ? imageUrls.length : 0,
    });
  } catch {}
  const resp = await fetch(arkEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${arkKey}`,
    },
    body: JSON.stringify(arkPayload),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    try { console.error('[Seedream][route] ark http error (non-stream)', { requestId, status: resp.status, contentType: resp.headers.get('content-type'), bodyPreview: errText?.slice?.(0, 400) }); } catch {}
    return new Response(JSON.stringify({ error: errText || 'Ark 请求失败' }), { status: 500 });
  }
  try { console.log('[Seedream][route] ark http ok (non-stream)', { requestId, status: resp.status, contentType: resp.headers.get('content-type') }); } catch {}
  const json = await resp.json();
  try { console.log('[Seedream][route] ark json received (non-stream)', { requestId, hasData: !!json, keys: json ? Object.keys(json).slice(0, 8) : [] }); } catch {}
  const { urls, b64 } = parseArkImages(json);
  const images: string[] = [];
  if (Array.isArray(urls)) {
    for (const u of urls) {
      if (typeof u === 'string' && u) images.push(u);
    }
  }
  if (Array.isArray(b64)) {
    for (const b of b64) {
      if (typeof b === 'string' && b) images.push(`data:image/png;base64,${b}`);
    }
  }
  try { console.log('[Seedream][route] parsed images (non-stream)', { requestId, urls: (urls || []).length, b64: (b64 || []).length, images: images.length }); } catch {}

  if (images.length === 0) {
    return new Response(
      JSON.stringify({ error: '生成失败\n结果包含敏感内容，请尝试重新编辑。' }),
      { status: 422, headers: { 'X-Request-Id': requestId, 'X-Model': modelToUse } }
    );
  }

  await Conversation.updateOne(
    { id: conversationId, userId: (user as any).sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'assistant',
          content: '',
          images,
          timestamp: new Date(),
          model: modelToUse,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  return Response.json(
    { message: { role: 'assistant', content: '', model: modelToUse, images }, requestId },
    { headers: { 'X-Request-Id': requestId, 'X-Model': modelToUse } }
  );
}


