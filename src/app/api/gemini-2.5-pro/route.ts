// Gemini 2.5 Pro Chat API Route (native Gemini style, multimodal input)
import { getConversationModel } from '@/lib/models/Conversation';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getUserModel } from '@/lib/models/User';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 获取当前用户的辅助函数
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

export async function POST(req: Request) {
  try { console.log('[GeminiPro] route hit'); } catch {}
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  if ((user as any).isBanned) return new Response(JSON.stringify({ error: '账户已被封禁' }), { status: 403 });

  let body: any = {};
  try {
    body = await req.json();
  } catch (e: any) {
    return new Response(JSON.stringify({ error: '请求体解析失败' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { conversationId, input, model, settings, stream, regenerate } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
    regenerate?: boolean;
  };

  const apiKey = process.env.AIHUBMIX_API_KEY as string | undefined;
  if (!apiKey) return new Response(JSON.stringify({ error: 'Missing AIHUBMIX_API_KEY' }), { status: 500 });
  const GEMINI_BASE_URL = 'https://aihubmix.com/gemini/v1beta';
  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  try {
    const inputType = Array.isArray(input) ? 'array' : typeof input;
    const inputInfo = Array.isArray(input)
      ? { turns: input.length, firstTurnParts: (Array.isArray(input?.[0]?.content) ? input[0].content.length : 0) }
      : { textLen: String(input ?? '').length };
    console.log('[GeminiPro][diag] request', JSON.stringify({ requestId, stream: !!stream, regenerate: !!regenerate, model, inputType, inputInfo }));
  } catch {}
  // 展示模型（对前端与落库保持简洁名称）
  const displayModel = 'gemini-2.5-pro' as const;
  // 上游真实模型映射（AiHubMix 当前常用预览编号）
  const resolveUpstreamModel = (id: string): string => {
    if (id === 'gemini-2.5-pro') return 'gemini-2.5-pro-preview-05-06';
    return id;
  };
  const upstreamModel = resolveUpstreamModel(typeof model === 'string' && model ? model : displayModel);
  try { console.log('[GeminiPro][diag] model', JSON.stringify({ requestId, displayModel, upstreamModel })); } catch {}

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

  if (!regenerate) {
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
  }

  // 获取历史并构建文本摘要
  const MAX_HISTORY = 30;
  const doc = await Conversation.findOne({ id: conversationId, userId: user.sub }, { messages: 1 }).lean();
  const fullHistory: any[] = Array.isArray((doc as any)?.messages) ? (doc as any).messages : [];
  const historyWithoutCurrent = regenerate ? fullHistory : (fullHistory.length > 0 ? fullHistory.slice(0, -1) : []);
  const buildHistoryText = (list: any[]): string => {
    const items = list.slice(-MAX_HISTORY).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'));
    return items.map((m: any) => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content ?? '')}`).join('\n');
  };
  const historyText = buildHistoryText(historyWithoutCurrent);

  // 构建 Gemini 原生 contents（可包含多模态）
  type GeminiPart = { text?: string } | { inlineData: { mimeType: string; data: string } };
  type GeminiContent = { role?: 'user' | 'model'; parts: GeminiPart[] };
  const parseDataUrl = (dataUrl: string): { mime: string; b64: string } | null => {
    try {
      const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
      if (!m) return null;
      return { mime: m[1], b64: m[2] };
    } catch { return null; }
  };
  const toGeminiPart = (item: any): GeminiPart | null => {
    if (!item || typeof item !== 'object') return null;
    if (item.type === 'input_text' && typeof item.text === 'string') {
      return { text: item.text };
    }
    // 图片
    if (item.type === 'input_image') {
      // 支持 data URL；远程 URL 退化为文本
      if (typeof item.image_url === 'string') {
        const parsed = parseDataUrl(item.image_url);
        if (parsed) return { inlineData: { mimeType: parsed.mime, data: parsed.b64 } };
        return { text: String(item.image_url) };
      }
      if (typeof item.image_data === 'string' && item.mime_type) {
        return { inlineData: { mimeType: String(item.mime_type), data: item.image_data } };
      }
    }
    // 音频
    if (item.type === 'input_audio') {
      const inl = item.inline_data;
      if (inl && typeof inl.data === 'string' && typeof inl.mime_type === 'string') {
        const parsed = parseDataUrl(inl.data);
        if (parsed) return { inlineData: { mimeType: parsed.mime, data: parsed.b64 } };
        return { inlineData: { mimeType: inl.mime_type, data: inl.data } };
      }
    }
    // 视频
    if (item.type === 'input_video') {
      const inl = item.inline_data;
      if (inl && typeof inl.data === 'string' && typeof inl.mime_type === 'string') {
        const parsed = parseDataUrl(inl.data);
        if (parsed) return { inlineData: { mimeType: parsed.mime, data: parsed.b64 } };
        return { inlineData: { mimeType: inl.mime_type, data: inl.data } };
      }
    }
    return null;
  };
  const buildGeminiContents = (src: string | any[]): GeminiContent[] => {
    const contents: GeminiContent[] = [];
    if (historyText) {
      contents.push({ role: 'user', parts: [{ text: `以下是对话历史（供参考）：\n${historyText}` }] });
    }
    if (Array.isArray(src)) {
      for (const turn of src) {
        const role = turn?.role === 'assistant' ? 'model' : 'user';
        const parts = Array.isArray(turn?.content) ? turn.content.map(toGeminiPart).filter(Boolean) as GeminiPart[] : [];
        if (parts.length > 0) contents.push({ role, parts });
      }
    } else {
      contents.push({ role: 'user', parts: [{ text: String(src ?? '') }] });
    }
    return contents;
  };

  // 构建 payload 与配置
  const contentsPayload = buildGeminiContents(input);
  try {
    const firstParts = contentsPayload?.[0]?.parts || [];
    console.log('[GeminiPro][diag] payload', JSON.stringify({ requestId, hasHistory: !!historyText, turns: contentsPayload.length, parts0: firstParts.length }));
  } catch {}
  const generationConfig: any = {
    response_mime_type: 'text/plain',
  };
  // 思考过程输出（2.5 Pro 可显示思考过程；仅在高推理努力时启用）
  let includeThoughts = false;
  try {
    includeThoughts = String(settings?.reasoning?.effort || '').toLowerCase() === 'high';
    if (includeThoughts) {
      generationConfig.thinking_config = { include_thoughts: true };
    }
  } catch {}
  if (typeof settings?.maxTokens === 'number') generationConfig.max_output_tokens = settings.maxTokens;
  if (typeof settings?.temperature === 'number') generationConfig.temperature = settings.temperature;
  // 系统指令：中文回复
  generationConfig.system_instruction = '总是用中文回复';
  // 如果包含多媒体，设置中等分辨率以控制 token 开销
  try {
    const hasInlineData = Array.isArray(contentsPayload) && contentsPayload.some((c: any) => Array.isArray(c?.parts) && c.parts.some((p: any) => p && (p.inlineData || p.inline_data)));
    if (hasInlineData) {
      generationConfig.media_resolution = 'MEDIA_RESOLUTION_MEDIUM';
    }
  } catch {}
  try {
    const cfg = { ...generationConfig } as any;
    if (cfg.system_instruction) cfg.system_instruction = '[hidden]';
    console.log('[GeminiPro][diag] generationConfig', JSON.stringify({ requestId, cfg }));
  } catch {}

  // 流式：SSE 转发
  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'start', requestId, route: 'gemini.generate_content', model: displayModel })}\n\n`)
          );

          const primaryUrl = `${GEMINI_BASE_URL}/models/${upstreamModel}:generateContent?alt=sse`;
          try { console.log('[GeminiPro][stream] POST', JSON.stringify({ requestId, url: primaryUrl })); } catch {}
          const makeHeaders = (variant: 'std' | 'xonly' | 'googonly') => ({
            ...(variant === 'std' || variant === 'googonly' ? { 'x-goog-api-key': apiKey } : {}),
            ...(variant === 'std' || variant === 'xonly' ? { 'x-api-key': apiKey } : {}),
            ...(variant === 'std' ? { 'Authorization': `Bearer ${apiKey}` } : {}),
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          } as Record<string, string>);
          const commonBody = JSON.stringify({
            model: upstreamModel,
            contents: contentsPayload,
            config: generationConfig,
            generationConfig,
            ...(includeThoughts ? { thinking_config: { include_thoughts: true }, thinkingConfig: { includeThoughts: true } } : {}),
            system_instruction: generationConfig.system_instruction,
            systemInstruction: generationConfig.system_instruction,
          });

          let resp = await fetch(primaryUrl, {
            method: 'POST',
            headers: makeHeaders('std'),
            body: commonBody,
          });

          if (!resp.ok) {
            const errText1 = await resp.text();
            try { console.error('[GeminiPro][stream] http error#1', JSON.stringify({ requestId, status: resp.status, bodyPreview: (errText1 || '').slice(0, 300) })); } catch {}
            // Fallback 1: 仅 x-api-key 头
            const resp2 = await fetch(primaryUrl, { method: 'POST', headers: makeHeaders('xonly'), body: commonBody });
            if (!resp2.ok) {
              const errText2 = await resp2.text();
              try { console.error('[GeminiPro][stream] http error#2', JSON.stringify({ requestId, status: resp2.status, bodyPreview: (errText2 || '').slice(0, 300) })); } catch {}
              // Fallback 2: 改用 /v1 路径（generateContent?alt=sse）
              const altUrl = `${GEMINI_BASE_URL.replace('/v1beta', '/v1')}/models/${upstreamModel}:generateContent?alt=sse`;
              try { console.log('[GeminiPro][stream] fallback url', JSON.stringify({ requestId, altUrl })); } catch {}
              const resp3 = await fetch(altUrl, { method: 'POST', headers: makeHeaders('xonly'), body: commonBody });
              if (!resp3.ok) {
                const errText3 = await resp3.text();
                try { console.error('[GeminiPro][stream] http error#3', JSON.stringify({ requestId, status: resp3.status, bodyPreview: (errText3 || '').slice(0, 300) })); } catch {}
                // Fallback 3: 改用非预览模型名
                const plainModel = 'gemini-2.5-pro';
                const altBody = JSON.stringify({
                  ...JSON.parse(commonBody),
                  model: plainModel,
                });
                const resp4 = await fetch(altUrl, { method: 'POST', headers: makeHeaders('xonly'), body: altBody });
                if (!resp4.ok) {
                  const errText4 = await resp4.text();
                  try { console.error('[GeminiPro][stream] http error#4', JSON.stringify({ requestId, status: resp4.status, bodyPreview: (errText4 || '').slice(0, 300) })); } catch {}
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errText4 || errText3 || errText2 || errText1 || `Gemini 流式请求失败 (${resp4.status})`, status: resp4.status, upstreamUrl: altUrl })}\n\n`)
                  );
                  controller.close();
                  return;
                }
                resp = resp4;
              } else {
                resp = resp3;
              }
            } else {
              resp = resp2;
            }
          }
          try {
            console.log('[GeminiPro][stream] headers', JSON.stringify({ requestId, contentType: resp.headers.get('content-type'), cacheControl: resp.headers.get('cache-control') }));
          } catch {}

          const reader = resp.body?.getReader();
          const decoder = new TextDecoder();
          if (!reader) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: '无法读取 Gemini 流' })}\n\n`));
            controller.close();
            return;
          }

          let sseBuffer = '';
          let answerAccum = '';
          let thoughtAccum = '';
          let eventCount = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            // 统一换行
            sseBuffer += chunk.replace(/\r\n/g, '\n');
            try { console.log('[GeminiPro][stream] chunk', JSON.stringify({ requestId, size: chunk.length })); } catch {}

            while (true) {
              const sepIndex = sseBuffer.indexOf('\n\n');
              if (sepIndex === -1) break;
              const block = sseBuffer.slice(0, sepIndex);
              sseBuffer = sseBuffer.slice(sepIndex + 2);

              try {
                const dataLines = block
                  .split('\n')
                  .filter((l) => l.startsWith('data:'))
                  .map((l) => {
                    const after = l.slice(5);
                    return after.startsWith(' ') ? after.slice(1) : after;
                  });
                if (dataLines.length === 0) continue;
                const payload = dataLines.join('\n');
                if (payload === '[DONE]' || payload === 'DONE') continue;
                const data = JSON.parse(payload);
                eventCount++;
                try {
                  const keys = Object.keys(data || {});
                  console.log('[GeminiPro][stream] event', JSON.stringify({ requestId, n: eventCount, keys, hasCandidates: !!data?.candidates }));
                } catch {}

                const parts = (data?.candidates?.[0]?.content?.parts || []) as any[];
                if (Array.isArray(parts) && parts.length > 0) {
                  let currThought = '';
                  let currAnswer = '';
                  for (const p of parts) {
                    const t = typeof p?.text === 'string' ? p.text : '';
                    if (!t) continue;
                    if (p?.thought) currThought += t; else currAnswer += t;
                  }
                  // reasoning 增量
                  if (currThought && currThought.length >= thoughtAccum.length) {
                    const delta = currThought.startsWith(thoughtAccum) ? currThought.slice(thoughtAccum.length) : currThought;
                    if (delta) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'reasoning', content: delta })}\n\n`));
                      try { console.log('[GeminiPro][stream] reasoning delta', JSON.stringify({ requestId, len: delta.length, preview: delta.slice(0, 80) })); } catch {}
                    }
                    thoughtAccum = currThought;
                  }
                  // content 增量
                  if (currAnswer && currAnswer.length >= answerAccum.length) {
                    const delta = currAnswer.startsWith(answerAccum) ? currAnswer.slice(answerAccum.length) : currAnswer;
                    if (delta) {
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`));
                      try { console.log('[GeminiPro][stream] content delta', JSON.stringify({ requestId, len: delta.length, preview: delta.slice(0, 80) })); } catch {}
                    }
                    answerAccum = currAnswer;
                  }
                }

                // usage 元数据（最后一个 chunk 才完整）
                if (data?.usageMetadata) {
                  try {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'debug', usage: data.usageMetadata })}\n\n`));
                    console.log('[GeminiPro][stream] usage', JSON.stringify({ requestId, usage: data.usageMetadata }));
                  } catch {}
                }
              } catch (parseErr) {
                try { console.debug('[GeminiPro][stream] parse error', parseErr); } catch {}
              }
            }
          }

          // 写入对话与收尾
          try {
            await Conversation.updateOne(
              { id: conversationId, userId: user.sub },
              {
                $push: {
                  messages: {
                    id: Date.now().toString(36),
                    role: 'assistant',
                    content: answerAccum,
                    timestamp: new Date(),
                    model: displayModel,
                    metadata: thoughtAccum ? { reasoning: thoughtAccum } : undefined,
                  },
                },
                $set: { updatedAt: new Date() },
              }
            );
            try { console.log('[GeminiPro][stream] db.write', JSON.stringify({ requestId, contentLen: answerAccum.length, reasoningLen: thoughtAccum.length })); } catch {}
          } catch {}

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          try { console.log('[GeminiPro][stream] done', JSON.stringify({ requestId, totalContentLen: answerAccum.length, totalReasoningLen: thoughtAccum.length, events: eventCount })); } catch {}
          controller.close();
        } catch (e: any) {
          try { console.error('[GeminiPro][stream] failed', e?.message || String(e)); } catch {}
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message || 'Gemini 流式请求失败' })}\n\n`)
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
        'X-Model': displayModel,
      },
    });
  }

  // 非流式
  let content = '';
  try {
    const url = `${GEMINI_BASE_URL}/models/${upstreamModel}:generateContent`;
    try { console.log('[GeminiPro] POST', JSON.stringify({ requestId, url })); } catch {}
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'x-api-key': apiKey,
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model: upstreamModel,
        contents: contentsPayload,
        config: generationConfig,
        generationConfig,
        ...(includeThoughts ? { thinking_config: { include_thoughts: true }, thinkingConfig: { includeThoughts: true } } : {}),
        system_instruction: generationConfig.system_instruction,
        systemInstruction: generationConfig.system_instruction,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      try { console.error('[GeminiPro][nonstream] http error', JSON.stringify({ requestId, status: resp.status, bodyPreview: (errText || '').slice(0, 400) })); } catch {}
      return new Response(
        JSON.stringify({ error: errText || `Gemini 请求失败 (${resp.status})` }),
        { status: resp.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    try {
      console.log('[GeminiPro][nonstream] headers', JSON.stringify({ requestId, contentType: resp.headers.get('content-type') }));
    } catch {}
    const data = await resp.json();
    try {
      console.log('[GeminiPro][nonstream] json keys', JSON.stringify({ requestId, keys: Object.keys(data || {}), hasCandidates: !!data?.candidates }));
    } catch {}
    // 提取文本：优先 text / output_text；兜底 candidates.parts[].text
    const tryExtract = (): string => {
      const t = (data?.text || data?.output_text || '') as string;
      if (t) return t;
      try {
        const c = data?.candidates?.[0]?.content?.parts || [];
        const out = c.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
        return out || '';
      } catch { return ''; }
    };
    content = tryExtract();
    try { console.log('[GeminiPro][nonstream] extracted', JSON.stringify({ requestId, contentLen: content.length, preview: content.slice(0, 120) })); } catch {}
  } catch (e: any) {
    console.error('[Gemini Pro] 非流式请求失败:', e?.message || String(e));
    return new Response(
      JSON.stringify({ error: e?.message || 'Gemini 请求失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  await Conversation.updateOne(
    { id: conversationId, userId: user.sub },
    {
      $push: {
        messages: {
          id: Date.now().toString(36),
          role: 'assistant',
          content,
          timestamp: new Date(),
          model: displayModel,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  return Response.json(
    {
      message: { role: 'assistant', content, model: displayModel },
      requestId,
    },
    { headers: { 'X-Request-Id': requestId, 'X-Model': displayModel } }
  );
}


