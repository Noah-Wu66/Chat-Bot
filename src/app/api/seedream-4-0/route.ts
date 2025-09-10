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
  const sd = settings?.seedream || {};
  const size: string = typeof sd?.size === 'string' && sd.size ? sd.size : '2K';
  const seqGen: 'auto' | 'on' | 'off' = 'auto';
  const maxImages: number = typeof sd?.maxImages === 'number' && sd.maxImages > 0 ? sd.maxImages : 1;
  const responseFormat: 'url' | 'b64_json' = 'b64_json';
  const watermark: boolean = false;

  const arkPayload: any = {
    model: 'doubao-seedream-4-0-250828',
    prompt: prompt,
    sequential_image_generation: seqGen,
    sequential_image_generation_options: { max_images: maxImages },
    response_format: responseFormat,
    size,
    stream: true,
    watermark,
  };
  if (Array.isArray(imageUrls) && imageUrls.length > 0) {
    arkPayload.image = imageUrls;
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

          const resp = await fetch(arkEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${arkKey}`,
            },
            body: JSON.stringify(arkPayload),
          });

          if (!resp.ok) {
            const errText = await resp.text().catch(() => '');
            throw new Error(errText || 'Ark 请求失败');
          }

          const json = await resp.json();
          const { urls, b64 } = parseArkImages(json);
          const images: string[] = [];
          for (const b of b64) images.push(`data:image/png;base64,${b}`);

          if (images.length === 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: 'error', error: '生成失败\n结果包含敏感内容，请尝试重新编辑。' })}\n\n`)
            );
            controller.close();
            return;
          }

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
          controller.close();
        } catch (e: any) {
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
  const resp = await fetch(arkEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${arkKey}`,
    },
    body: JSON.stringify(arkPayload),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    return new Response(JSON.stringify({ error: errText || 'Ark 请求失败' }), { status: 500 });
  }
  const json = await resp.json();
  const { urls, b64 } = parseArkImages(json);
  const images: string[] = [];
  for (const b of b64) images.push(`data:image/png;base64,${b}`);

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


