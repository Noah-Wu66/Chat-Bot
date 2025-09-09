// Gemini 2.5 Pro Chat API Route (native Gemini style, multimodal input)
import { getConversationModel } from '@/lib/models/Conversation';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getUserModel } from '@/lib/models/User';

export const runtime = 'nodejs';

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
  const user = await getCurrentUser();
  if (!user) return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  if ((user as any).isBanned) return new Response(JSON.stringify({ error: '账户已被封禁' }), { status: 403 });

  const body = await req.json();
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
  const GEMINI_BASE_URL = 'https://aihubmix.com/gemini';
  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  const modelToUse = 'gemini-2.5-pro' as const;

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
  type GeminiPart = { text?: string } | { inline_data: { mime_type: string; data: string } };
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
        if (parsed) return { inline_data: { mime_type: parsed.mime, data: parsed.b64 } };
        return { text: String(item.image_url) };
      }
      if (typeof item.image_data === 'string' && item.mime_type) {
        return { inline_data: { mime_type: String(item.mime_type), data: item.image_data } };
      }
    }
    // 音频
    if (item.type === 'input_audio') {
      const inl = item.inline_data;
      if (inl && typeof inl.data === 'string' && typeof inl.mime_type === 'string') {
        const parsed = parseDataUrl(inl.data);
        if (parsed) return { inline_data: { mime_type: parsed.mime, data: parsed.b64 } };
        return { inline_data: { mime_type: inl.mime_type, data: inl.data } };
      }
    }
    // 视频
    if (item.type === 'input_video') {
      const inl = item.inline_data;
      if (inl && typeof inl.data === 'string' && typeof inl.mime_type === 'string') {
        const parsed = parseDataUrl(inl.data);
        if (parsed) return { inline_data: { mime_type: parsed.mime, data: parsed.b64 } };
        return { inline_data: { mime_type: inl.mime_type, data: inl.data } };
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

  // 统一使用非流式 Gemini 原生接口，前端按 JSON 路径处理

  // 非流式
  const contentsPayload = buildGeminiContents(input);
  const generationConfig: any = {
    response_mime_type: 'text/plain',
  };
  if (typeof settings?.maxTokens === 'number') generationConfig.max_output_tokens = settings.maxTokens;
  if (typeof settings?.temperature === 'number') generationConfig.temperature = settings.temperature;
  // 系统指令：中文回复
  generationConfig.system_instruction = '总是用中文回复';

  let content = '';
  try {
    const resp = await fetch(`${GEMINI_BASE_URL}/models/${modelToUse}:generateContent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'x-goog-api-key': apiKey,
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        model: modelToUse,
        contents: contentsPayload,
        config: generationConfig,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(
        JSON.stringify({ error: errText || `Gemini 请求失败 (${resp.status})` }),
        { status: resp.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const data = await resp.json();
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
          model: modelToUse,
        },
      },
      $set: { updatedAt: new Date() },
    }
  );

  return Response.json(
    {
      message: { role: 'assistant', content, model: modelToUse },
      requestId,
    },
    { headers: { 'X-Request-Id': requestId, 'X-Model': modelToUse } }
  );
}


