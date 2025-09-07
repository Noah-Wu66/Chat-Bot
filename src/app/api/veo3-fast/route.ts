import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getConversationModel } from '@/lib/models/Conversation';

export const runtime = 'nodejs';

function getFalKey(): string | null {
  try {
    return process.env.FAL_KEY || null;
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
  return payload;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });

  const falKey = getFalKey();
  if (!falKey) return new Response(JSON.stringify({ error: '缺少 FAL_KEY' }), { status: 500 });

  const {
    conversationId,
    input,
    model,
    settings,
    stream,
    regenerate,
  } = await req.json();

  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);

  // 无上下文：不读取历史，仅按当前输入决定走文生视频或图生视频
  const textPrompt: string = Array.isArray(input)
    ? (() => {
        const first = input.find((i: any) => Array.isArray(i?.content));
        const contentArr = Array.isArray(first?.content) ? first.content : [];
        const textItem = contentArr.find((c: any) => c?.type === 'input_text');
        return textItem?.text || '';
      })()
    : String(input ?? '');

  const imageUrl: string | null = Array.isArray(input)
    ? (() => {
        const first = input.find((i: any) => Array.isArray(i?.content));
        const contentArr = Array.isArray(first?.content) ? first.content : [];
        const img = contentArr.find((c: any) => c?.type === 'input_image');
        const url: string | undefined = (typeof img?.image_url === 'string' && img.image_url) ? img.image_url
          : (typeof img?.image_url?.url === 'string' ? img.image_url.url : undefined);
        return url || null;
      })()
    : null;

  // 记录用户消息（仅文本展示）
  if (!regenerate) {
    await Conversation.updateOne(
      { id: conversationId, userId: user.sub },
      {
        $push: {
          messages: {
            id: Date.now().toString(36),
            role: 'user',
            content: textPrompt,
            timestamp: new Date(),
            model,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );
  }

  // FAL 请求体
  const veo = settings?.veo3 || {};
  const aspect_ratio = veo?.aspectRatio || '16:9';
  const duration = veo?.duration || '8s';
  const resolution = veo?.resolution || '720p';
  const generate_audio = typeof veo?.generateAudio === 'boolean' ? veo.generateAudio : true;
  const enhance_prompt = typeof veo?.enhancePrompt === 'boolean' ? veo.enhancePrompt : true;
  const auto_fix = typeof veo?.autoFix === 'boolean' ? veo.autoFix : true;

  const endpoint = imageUrl
    ? 'https://fal.run/fal-ai/veo3/fast/image-to-video'
    : 'https://fal.run/fal-ai/veo3/fast';

  const payload: any = imageUrl
    ? {
        input: {
          prompt: textPrompt || 'Animate this image',
          image_url: imageUrl,
          duration,
          generate_audio,
          resolution,
        },
        logs: true,
      }
    : {
        input: {
          prompt: textPrompt,
          aspect_ratio,
          duration,
          enhance_prompt,
          auto_fix,
          resolution,
          generate_audio,
        },
        logs: true,
      };

  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'start', requestId, route: 'fal.veo3.fast', model: 'veo3-fast' })}\n\n`));

          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Key ${falKey}`,
            },
            body: JSON.stringify(payload),
          });

          if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err || 'FAL 请求失败');
          }

          const data = await resp.json();
          // 文档返回 { data: { video: { url } } } 或直接 { video: { url } }
          const videoUrl = data?.data?.video?.url || data?.video?.url || null;

          if (videoUrl) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'video', url: videoUrl })}\n\n`));
          }

          // 写入数据库助手消息
          try {
            await Conversation.updateOne(
              { id: conversationId, userId: user.sub },
              {
                $push: {
                  messages: {
                    id: Date.now().toString(36),
                    role: 'assistant',
                    content: '',
                    videos: videoUrl ? [videoUrl] : undefined,
                    timestamp: new Date(),
                    model: 'veo3-fast',
                  },
                },
                $set: { updatedAt: new Date() },
              }
            );
          } catch {}

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (e: any) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message || String(e) })}\n\n`));
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
        'X-Model': 'veo3-fast',
      },
    });
  }

  // 非流式
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Key ${falKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const err = await resp.text();
    return new Response(JSON.stringify({ error: err || 'FAL 请求失败' }), { status: 500 });
  }
  const data = await resp.json();
  const videoUrl = data?.data?.video?.url || data?.video?.url || null;

  await Conversation.updateOne(
    { id: conversationId, userId: user.sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'assistant',
          content: '',
          videos: videoUrl ? [videoUrl] : undefined,
          timestamp: new Date(),
          model: 'veo3-fast',
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  return Response.json({
    message: {
      role: 'assistant',
      content: '',
      model: 'veo3-fast',
      videos: videoUrl ? [videoUrl] : undefined,
    },
    requestId,
  }, { headers: { 'X-Request-Id': requestId, 'X-Model': 'veo3-fast' } });
}


