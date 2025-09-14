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
  const { conversationId, input, model, settings, stream = true, regenerate } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings?: any;
    stream?: boolean;
    regenerate?: boolean;
  };

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

  // Ark Content Generation API
  const BASE = 'https://ark.cn-beijing.volces.com/api/v3';
  const createEndpoints = [
    `${BASE}/contents/generations/tasks`,
    `${BASE}/content-generation/tasks`,
    `${BASE}/content_generation/tasks`,
  ];
  const headerVariantsPost: Array<Record<string, string>> = [
    { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `Bearer ${arkKey}` },
    { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Authorization': `${arkKey}` },
    { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-API-KEY': `${arkKey}` },
    { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-Api-Key': `${arkKey}` },
  ];
  const headerVariantsGet: Array<Record<string, string>> = [
    { 'Accept': 'application/json', 'Authorization': `Bearer ${arkKey}` },
    { 'Accept': 'application/json', 'Authorization': `${arkKey}` },
    { 'Accept': 'application/json', 'X-API-KEY': `${arkKey}` },
    { 'Accept': 'application/json', 'X-Api-Key': `${arkKey}` },
  ];

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
    // 简化：非流式仅返回任务创建结果（前端目前仅走流式）
    let createResp: Response | null = null;
    let lastErrText = '';
    for (const ep of createEndpoints) {
      for (const hv of headerVariantsPost) {
        const r = await fetch(ep, { method: 'POST', headers: hv, body: JSON.stringify(createPayload) });
        if (r.ok) { createResp = r; break; }
        lastErrText = await r.text().catch(() => '');
      }
      if (createResp) break;
    }
    if (!createResp) {
      return new Response(JSON.stringify({ error: lastErrText || 'Ark 请求失败' }), { status: 500 });
    }
    const json = await createResp.json();
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

        // 1) 创建任务
        let createResp: Response | null = null;
        let createStatus = 0;
        let createErrText = '';
        let chosenCreateEp = '';
        let chosenHeaderIdx = -1;
        for (const ep of createEndpoints) {
          for (let i = 0; i < headerVariantsPost.length; i++) {
            const hv = headerVariantsPost[i];
            const r = await fetch(ep, { method: 'POST', headers: hv, body: JSON.stringify(createPayload) });
            if (r.ok) { createResp = r; createStatus = r.status; chosenCreateEp = ep; chosenHeaderIdx = i; break; }
            createStatus = r.status;
            createErrText = await r.text().catch(() => '');
          }
          if (createResp) break;
        }
        if (createResp) {
          try {
            // 记录成功使用的 endpoint 与头部变体索引（不泄露密钥）
            send({ type: 'debug', phase: 'create', endpoint: chosenCreateEp || 'auto', headerVariant: chosenHeaderIdx });
          } catch {}
        }
        if (!createResp) {
          const bodyPreview = (createErrText || '').slice(0, 400);
          const extraHint = createStatus === 401 ? ' 认证失败：请检查 ARK_API_KEY 是否正确、未包含多余空格/换行，并确认已为 doubao-seedance-1-0-pro 开通服务（区域 cn-beijing，Ark v3）。' : '';
          const msg = `Ark 创建任务失败${createStatus ? ` (${createStatus})` : ''}${bodyPreview ? `: ${bodyPreview}` : ''}${extraHint}`;
          send({ type: 'error', error: msg });
          controller.close();
          return;
        }
        const createJson = await createResp.json();
        const taskId: string | undefined = createJson?.id || createJson?.data?.id || createJson?.task_id;
        if (!taskId) throw new Error('未获取到任务 ID');

        // 2) 轮询任务状态
        const getEndpoints = [
          `${BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
          `${BASE}/content-generation/tasks/${encodeURIComponent(taskId)}`,
          `${BASE}/content_generation/tasks/${encodeURIComponent(taskId)}`,
        ];
        let loops = 0;
        let sentVideo = false;
        while (true) {
          loops++;
          let getResp: Response | null = null;
          let getStatus = 0;
          let getErrText = '';
          for (const gep of getEndpoints) {
            for (const hv of headerVariantsGet) {
              const r = await fetch(gep, { headers: hv });
              if (r.ok) { getResp = r; getStatus = r.status; break; }
              getStatus = r.status;
              getErrText = await r.text().catch(() => '');
            }
            if (getResp) break;
          }
          if (!getResp) {
            send({ type: 'debug', status: 'poll_failed', http: getStatus, body: (getErrText || '').slice(0, 200) });
            await new Promise((r) => setTimeout(r, 10000));
            continue;
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


