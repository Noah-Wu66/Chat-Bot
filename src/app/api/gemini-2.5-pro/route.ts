// Gemini 2.5 Pro Chat API Route (基于官方指南结构)
import { getAIClient } from '@/lib/ai';

import { getConversationModel } from '@/lib/models/Conversation';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';
import { getUserModel } from '@/lib/models/User';
import { performWebSearchSummary } from '@/lib/router';

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

// OpenRouter 模型映射
const MODEL_NAME = 'google/gemini-2.5-pro';

// Types 定义（模拟官方 SDK 的类型结构）
interface Part {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

interface ThinkingConfig {
  include_thoughts?: boolean;
}

interface GenerateContentConfig {
  temperature?: number;
  maxOutputTokens?: number;
}

// 解析 data URL
function parseDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  try {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    return { mimeType: match[1], data: match[2] };
  } catch {
    return null;
  }
}

// 创建 Part 对象（模拟官方 SDK 的 types.Part）
function createTextPart(text: string): Part {
  return { text };
}

function createInlineDataPart(data: string, mimeType: string): Part {
  return {
    inlineData: {
      mimeType,
      data,
    },
  };
}

// 转换输入为 Gemini Part
function toGeminiPart(item: any): Part | null {
  if (!item || typeof item !== 'object') return null;

  // 文本
  if (item.type === 'input_text' && typeof item.text === 'string') {
    return createTextPart(item.text);
  }

  // 图片
  if (item.type === 'input_image') {
    if (typeof item.image_url === 'string') {
      const parsed = parseDataUrl(item.image_url);
      if (parsed) {
        return createInlineDataPart(parsed.data, parsed.mimeType);
      }
      // 远程 URL 作为文本处理
      return createTextPart(item.image_url);
    }
    if (typeof item.image_data === 'string' && item.mime_type) {
      return createInlineDataPart(item.image_data, item.mime_type);
    }
  }

  // 音频
  if (item.type === 'input_audio') {
    const inlineData = item.inline_data;
    if (inlineData && typeof inlineData.data === 'string' && typeof inlineData.mime_type === 'string') {
      const parsed = parseDataUrl(inlineData.data);
      if (parsed) {
        return createInlineDataPart(parsed.data, parsed.mimeType);
      }
      return createInlineDataPart(inlineData.data, inlineData.mime_type);
    }
  }

  // 视频
  if (item.type === 'input_video') {
    const inlineData = item.inline_data;
    if (inlineData && typeof inlineData.data === 'string' && typeof inlineData.mime_type === 'string') {
      const parsed = parseDataUrl(inlineData.data);
      if (parsed) {
        return createInlineDataPart(parsed.data, parsed.mimeType);
      }
      return createInlineDataPart(inlineData.data, inlineData.mime_type);
    }
  }

  return null;
}

// 构建 Gemini Contents（模拟官方 SDK 的结构）
function buildGeminiContents(input: string | any[], historyText: string): Content[] {
  const contents: Content[] = [];

  // 添加历史上下文
  if (historyText) {
    contents.push({
      role: 'user',
      parts: [createTextPart(`以下是对话历史（供参考）：\n${historyText}`)],
    });
  }

  // 处理输入
  if (Array.isArray(input)) {
    for (const turn of input) {
      const role = turn?.role === 'assistant' ? 'model' : 'user';
      const parts: Part[] = [];

      if (Array.isArray(turn?.content)) {
        for (const item of turn.content) {
          const part = toGeminiPart(item);
          if (part) parts.push(part);
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }
  } else {
    contents.push({
      role: 'user',
      parts: [createTextPart(String(input ?? ''))],
    });
  }

  return contents;
}

export async function POST(req: Request) {
// 标记部分工具函数为已使用，避免构建时未使用警告（不影响运行）
void [createTextPart, createInlineDataPart, toGeminiPart, buildGeminiContents];


  const user = await getCurrentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: '未登录' }), { status: 401 });
  }
  if ((user as any).isBanned) {
    return new Response(JSON.stringify({ error: '账户已被封禁' }), { status: 403 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch (e: any) {
    return new Response(JSON.stringify({ error: '请求体解析失败' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const { conversationId, input, model, settings, stream, regenerate, webSearch } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
    regenerate?: boolean;
    webSearch?: boolean;
  };

  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);


  // 提取用户消息文本（用于记录）
  let userContent = '';
  if (Array.isArray(input)) {
    const first = input.find((i: any) => Array.isArray(i?.content));
    const contentArr = Array.isArray(first?.content) ? first.content : [];
    const textItem = contentArr.find((c: any) => c?.type === 'input_text');
    userContent = textItem?.text || '[复合输入]';
  } else {
    userContent = input;
  }

  // 记录用户消息
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

  // 获取对话历史
  const MAX_HISTORY = 30;
  const doc = await Conversation.findOne({ id: conversationId, userId: user.sub }, { messages: 1 }).lean();
  const fullHistory: any[] = Array.isArray((doc as any)?.messages) ? (doc as any).messages : [];
  const historyWithoutCurrent = regenerate ? fullHistory : (fullHistory.length > 0 ? fullHistory.slice(0, -1) : []);

  const buildHistoryText = (list: any[]): string => {
    const items = list.slice(-MAX_HISTORY).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'));
    return items.map((m: any) => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content ?? '')}`).join('\n');
  };

  const historyText = buildHistoryText(historyWithoutCurrent);

  // 构建请求内容（保留调用以兼容旧逻辑，无副作用）
  void buildGeminiContents(input, historyText);

  // 可选：联网搜索（与 GPT-5 对齐：注入一条带有 Markdown 的前置“用户材料”消息，并记录 sources）
  let searchUsed = false;
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
    if (typeof settings?.web?.size !== 'number') {
      return new Response(JSON.stringify({ error: '\u7f3a\u5c11\u6216\u975e\u6cd5\u53c2\u6570\uff1aweb.size' }), { status: 400 });
    }
    const { markdown, used, sources } = await performWebSearchSummary(currText, settings.web.size);
    if (used && markdown) {
      contents.unshift({
        role: 'user',
        parts: [createTextPart(`以下为联网搜索到的材料（供参考，不保证准确）：\n\n${markdown}`)],
      });
      searchUsed = true;
      searchSources = Array.isArray(sources) ? sources : null;
    }
  }



  // 检查是否包含多媒体内容
  const hasInlineData = contents.some(content =>
    content.parts.some(part => part.inlineData)
  );


  // 流式响应处理（OpenRouter Chat Completions）
  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              type: 'start',
              requestId,
              route: 'chat.completions',
              model: MODEL_NAME
            })}\n\n`)
          );

          // 与 GPT-5 一致：在开始读取流前告知前端本次使用了搜索及来源列表
          if (searchUsed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'search', used: true })}\n\n`));
            if (Array.isArray(searchSources) && searchSources.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'search_sources', sources: searchSources })}\n\n`)
              );
            }
          }

          const ai = getAIClient();

          // 将 input/history 转换为 OpenRouter Chat messages
          type CCPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
          type CCMessage = { role: 'system' | 'user' | 'assistant'; content: CCPart[] | string };
          const toCCPart = (item: any): CCPart | null => {
            if (!item || typeof item !== 'object') return null;
            if (item.type === 'input_text' && typeof item.text === 'string') return { type: 'text', text: item.text };
            if (item.type === 'input_image') {
              if (typeof item.image_url === 'string' && item.image_url) return { type: 'image_url', image_url: { url: item.image_url } };
              const mime = typeof item.mime_type === 'string' && item.mime_type ? item.mime_type : 'image/png';
              if (typeof item.image_data === 'string' && item.image_data) return { type: 'image_url', image_url: { url: `data:${mime};base64,${item.image_data}` } };
            }
            return null;
          };
          const buildMessages = (src: string | any[]): CCMessage[] => {
            const msgs: CCMessage[] = [];
            msgs.push({ role: 'system', content: [{ type: 'text', text: '总是用中文回复' }] as CCPart[] });
            if (historyText) msgs.push({ role: 'user', content: [{ type: 'text', text: `以下是对话历史（供参考）：\n${historyText}` }] as CCPart[] });
            if (Array.isArray(src)) {
              for (const turn of src) {
                const role = turn?.role === 'assistant' ? 'assistant' : 'user';
                const parts = Array.isArray(turn?.content) ? turn.content.map(toCCPart).filter(Boolean) as CCPart[] : [];
                if (parts.length > 0) msgs.push({ role, content: parts });
              }
            } else {
              msgs.push({ role: 'user', content: [{ type: 'text', text: String(src ?? '') }] as CCPart[] });
            }
            return msgs;
          };

          let messages = buildMessages(input);

          const streamResp: any = await (ai as any).chat.completions.create({
            model: MODEL_NAME,
            messages,
            stream: true,
            ...(typeof settings?.temperature === 'number' ? { temperature: settings.temperature } : {}),
            ...(typeof settings?.maxTokens === 'number' ? { max_tokens: settings.maxTokens } : {}),
          });

          let answerAccum = '';
          for await (const chunk of streamResp) {
            try {
              const delta = chunk?.choices?.[0]?.delta?.content;
              if (delta) {
                answerAccum += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'content', content: delta })}\n\n`)
                );
              }
            } catch {}
          }

          // 保存助手消息
          await Conversation.updateOne(
            { id: conversationId, userId: user.sub },
            {
              $push: {
                messages: {
                  id: Date.now().toString(36),
                  role: 'assistant',
                  content: answerAccum,
                  timestamp: new Date(),
                  model: MODEL_NAME,
                  metadata: (searchUsed)
                    ? { searchUsed: true, sources: searchSources || undefined }
                    : undefined,
                },
              },
              $set: { updatedAt: new Date() },
            }
          );

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          );
          controller.close();
        } catch (e: any) {
          console.error('[Gemini 2.5 Pro][OpenRouter] stream failed', e?.message || String(e));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', error: e?.message || '流式请求失败' })}\n\n`)
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
        'X-Model': MODEL_NAME,
      },
    });
  }

  // 非流式响应处理（OpenRouter Chat Completions）
  try {
    const ai = getAIClient();

    // 构建 messages
    type CCPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
    type CCMessage = { role: 'system' | 'user' | 'assistant'; content: CCPart[] | string };
    const toCCPart = (item: any): CCPart | null => {
      if (!item || typeof item !== 'object') return null;
      if (item.type === 'input_text' && typeof item.text === 'string') return { type: 'text', text: item.text };
      if (item.type === 'input_image') {
        if (typeof item.image_url === 'string' && item.image_url) return { type: 'image_url', image_url: { url: item.image_url } };
        const mime = typeof item.mime_type === 'string' && item.mime_type ? item.mime_type : 'image/png';
        if (typeof item.image_data === 'string' && item.image_data) return { type: 'image_url', image_url: { url: `data:${mime};base64,${item.image_data}` } };
      }
      return null;
    };
    const buildMessages = (src: string | any[]): CCMessage[] => {
      const msgs: CCMessage[] = [];
      msgs.push({ role: 'system', content: [{ type: 'text', text: '总是用中文回复' }] as CCPart[] });
      if (historyText) msgs.push({ role: 'user', content: [{ type: 'text', text: `以下是对话历史（供参考）：\n${historyText}` }] as CCPart[] });
      if (Array.isArray(src)) {
        for (const turn of src) {
          const role = turn?.role === 'assistant' ? 'assistant' : 'user';
          const parts = Array.isArray(turn?.content) ? turn.content.map(toCCPart).filter(Boolean) as CCPart[] : [];
          if (parts.length > 0) msgs.push({ role, content: parts });
        }
      } else {
        msgs.push({ role: 'user', content: [{ type: 'text', text: String(src ?? '') }] as CCPart[] });
      }
      return msgs;
    };

    let messages = buildMessages(input);

    const resp: any = await (ai as any).chat.completions.create({
      model: MODEL_NAME,
      messages,
      ...(typeof settings?.temperature === 'number' ? { temperature: settings.temperature } : {}),
      ...(typeof settings?.maxTokens === 'number' ? { max_tokens: settings.maxTokens } : {}),
    });

    const choice = resp?.choices?.[0];
    const msg = choice?.message || {};
    const content: string = typeof msg?.content === 'string' ? msg.content : '';

    await Conversation.updateOne(
      { id: conversationId, userId: user.sub },
      {
        $push: {
          messages: {
            id: Date.now().toString(36),
            role: 'assistant',
            content,
            timestamp: new Date(),
            model: MODEL_NAME,
            metadata: (searchUsed) ? { searchUsed: true, sources: searchSources || undefined } : undefined,
          },
        },
        $set: { updatedAt: new Date() },
      }
    );

    return Response.json(
      {
        message: { role: 'assistant', content, model: MODEL_NAME },
        requestId,
      },
      { headers: { 'X-Request-Id': requestId, 'X-Model': MODEL_NAME } }
    );
  } catch (e: any) {
    console.error('[Gemini 2.5 Pro][OpenRouter] 请求失败:', e?.message || String(e));
    return new Response(
      JSON.stringify({ error: e?.message || '请求失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

