import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getUserModel } from '@/lib/models/User';
import { getConversationModel } from '@/lib/models/Conversation';

export const runtime = 'nodejs';

function getArkKey(): string | null {
  try {
    const p: any = (globalThis as any)?.process;
    const raw = p?.env?.ARK_API_KEY ?? p?.env?.ARK_KEY ?? p?.env?.VOLC_ARK_API_KEY;
    if (typeof raw !== 'string') return null;
    const v = raw.trim();
    return v ? v : null;
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

function extractTextAndFirstHttpImage(input: string | any[]): { text: string; imageUrl: string | null } {
  if (Array.isArray(input)) {
    const first = input.find((i: any) => Array.isArray(i?.content));
    const contentArr = Array.isArray(first?.content) ? first.content : [];
    const textItem = contentArr.find((c: any) => c?.type === 'input_text');
    const text = textItem?.text || '';
    let imageUrl: string | null = null;
    for (const it of contentArr) {
      if (it && it.type === 'input_image') {
        const maybe = typeof it.image_url === 'string' ? it.image_url : (it?.image_url?.url || '');
        if (typeof maybe === 'string' && /^https?:\/\//i.test(maybe)) { imageUrl = maybe; break; }
      }
    }
    return { text, imageUrl };
  }
  return { text: String(input ?? ''), imageUrl: null };
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
    settings?: any;
    stream?: boolean;
    regenerate?: boolean;
  };
  if (typeof stream !== 'boolean') {
    return new Response(JSON.stringify({ error: '\u7f3a\u5c11\u6216\u975e\u6cd5\u53c2\u6570\uff1astream' }), { status: 400 });
  }

  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const modelToUse = 'seedance-1.0-pro' as const;

  // 记录用户消息（仅文本内容）
  const { text: userText } = extractTextAndFirstHttpImage(input);
  if (!regenerate) {
    try {
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
    } catch {}
  }

  // Ark Content Generation API（精简为单一端点与头部）
  const BASE = 'https://ark.cn-beijing.volces.com/api/v3';
  const CREATE_ENDPOINT = `${BASE}/contents/generations/tasks`;
  const GET_ENDPOINT = (taskId: string) => `${BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  const headersPost: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': `Bearer ${arkKey}`,
  };
  const headersGet: Record<string, string> = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${arkKey}`,
  };

  const { text: prompt, imageUrl } = extractTextAndFirstHttpImage(input);
  // 从设置组装文本后缀命令（--rt/--dur/--fps/--rs/--wm/--cf/--seed）
  const sd = (settings && settings.seedance) ? settings.seedance : {};
  const parts: string[] = [];
  if (sd && typeof sd === 'object') {
    const rt = sd.ratio as string | undefined;
    if (rt) {
      const allowed = ['16:9','4:3','1:1','3:4','9:16','21:9'];
      const isAdaptive = rt === 'adaptive';
      if (allowed.indexOf(rt) !== -1 || (isAdaptive && !!imageUrl)) {
        parts.push(`--ratio ${rt}`);
      }
    }
    const dur = typeof sd.duration === 'number' ? sd.duration : undefined;
    if (typeof dur === 'number' && dur >= 3 && dur <= 12) parts.push(`--duration ${dur}`);
    // 不展示/不修改 FPS，遵循模型默认 24
    const rs = sd.resolution as string | undefined;
    if (rs && ['480p','720p','1080p'].indexOf(rs) !== -1) parts.push(`--resolution ${rs}`);
    // 水印：跟随设置（未设置则不传，沿用模型默认）
    if (typeof sd.watermark === 'boolean') parts.push(`--watermark ${sd.watermark ? 'true' : 'false'}`);
    const cf = sd.cameraFixed;
    // 仅文生视频支持 camerafixed；图生视频（提供参考图/首帧）时不传
    if (!imageUrl && typeof cf === 'boolean') parts.push(`--camerafixed ${cf ? 'true' : 'false'}`);
    const seed = typeof sd.seed === 'number' ? sd.seed : undefined;
    if (typeof seed === 'number') parts.push(`--seed ${seed}`);
  }
  const promptWithParams = `${(prompt || '').trim()}${parts.length > 0 ? ' ' + parts.join(' ') : ''}`.trim();
  const content: any[] = [];
  content.push({ type: 'text', text: promptWithParams });
  if (imageUrl) {
    content.push({ type: 'image_url', image_url: { url: imageUrl } });
  }

  const createPayload = {
    model: 'doubao-seedance-1-0-pro-250528',
    content,
  } as const;

  if (!stream) {
    // 非流式：直接创建任务并返回结果
    const r = await fetch(CREATE_ENDPOINT, { method: 'POST', headers: headersPost, body: JSON.stringify(createPayload) });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return new Response(JSON.stringify({ error: errText || 'Ark 请求失败' }), { status: r.status || 500 });
    }
    const json = await r.json();
    return Response.json({ task: json, requestId }, { headers: { 'X-Request-Id': requestId, 'X-Model': modelToUse } });
  }

  const encoder = new TextEncoder();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch {}
      };
      try {
        send({ type: 'start', requestId, route: 'ark.content_generation', model: modelToUse });

        // 1) 创建任务（使用单一端点与头部，无回退/重试）
        const createResp = await fetch(CREATE_ENDPOINT, { method: 'POST', headers: headersPost, body: JSON.stringify(createPayload) });
        const createStatus = createResp.status;
        if (!createResp.ok) {
          const bodyPreview = (await createResp.text().catch(() => '')).slice(0, 400);
          const msg = `Ark 创建任务失败${createStatus ? ` (${createStatus})` : ''}${bodyPreview ? `: ${bodyPreview}` : ''}`;
          send({ type: 'error', error: msg });
          controller.close();
          return;
        }
        const createJson = await createResp.json();
        const taskId: string | undefined = createJson?.id || createJson?.data?.id || createJson?.task_id;
        if (!taskId) throw new Error('未获取到任务 ID');

        // 2) 轮询任务状态（使用单一端点与头部，无回退/重试）
        let loops = 0;
        let sentVideo = false;
        while (true) {
          loops++;
          const getResp = await fetch(GET_ENDPOINT(taskId), { headers: headersGet });
          const getStatus = getResp.status;
          if (!getResp.ok) {
            const errText = await getResp.text().catch(() => '');
            send({ type: 'error', error: `Ark 轮询失败${getStatus ? ` (${getStatus})` : ''}${errText ? `: ${errText.slice(0, 200)}` : ''}` });
            controller.close();
            return;
          }
          try { send({ type: 'debug', phase: 'poll', http: getStatus }); } catch {}
          const getJson: any = await getResp.json();
          const status: string = getJson?.status || getJson?.data?.status || '';
          if (!status) {
            throw new Error('返回状态为空');
          }
          if (status === 'succeeded') {
            const content = getJson?.content || getJson?.data?.content || {};
            const videoUrl: string | undefined = content?.video_url || content?.video?.url || getJson?.video_url;
            if (!videoUrl) {
              throw new Error('生成成功但未返回视频 URL');
            }
            if (!sentVideo) {
              send({ type: 'video', url: videoUrl });
              try {
                await Conversation.updateOne(
                  { id: conversationId, userId: (user as any).sub },
                  {
                    $push: {
                      messages: {
                        id: Date.now().toString(36),
                        role: 'assistant',
                        content: '',
                        videos: [videoUrl],
                        timestamp: new Date(),
                        model: modelToUse,
                      },
                    },
                    $set: { updatedAt: new Date() },
                  }
                );
              } catch {}
              sentVideo = true;
            }
            send({ type: 'done' });
            controller.close();
            return;
          } else if (status === 'failed' || status === 'cancelled') {
            const err = getJson?.error || getJson?.data?.error || '生成失败';
            send({ type: 'error', error: typeof err === 'string' ? err : (err?.message || '生成失败') });
            controller.close();
            return;
          } else {
            // 透出状态心跳，避免连接超时（前端忽略未知类型即可）
            send({ type: 'debug', status, loops });
          }
          // 官方示例建议 10s
          await new Promise((r) => setTimeout(r, 10000));
        }
      } catch (e: any) {
        send({ type: 'error', error: e?.message || String(e) });
        try { controller.close(); } catch {}
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


