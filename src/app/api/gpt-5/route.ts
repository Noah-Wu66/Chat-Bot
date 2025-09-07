// GPT-5 Responses API Route
import { getAIClient } from '@/lib/ai';
import { performWebSearchSummary } from '@/lib/router';
import { getConversationModel } from '@/lib/models/Conversation';
import { cookies } from 'next/headers';
import { verifyJWT } from '@/lib/auth';

export const runtime = 'nodejs';

// 获取当前用户的辅助函数
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

  const body = await req.json();
  const { conversationId, input, model, settings, stream, webSearch, regenerate } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
    webSearch?: boolean;
    regenerate?: boolean;
  };

  const ai = getAIClient();
  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  // GPT-5 Responses API
  const modelToUse: 'gpt-5' = 'gpt-5';

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

  // 从数据库获取历史，构建用于 Responses API 的上下文输入
  const MAX_HISTORY = 30;
  const doc = await Conversation.findOne({ id: conversationId, userId: user.sub }, { messages: 1 }).lean();
  const fullHistory: any[] = Array.isArray((doc as any)?.messages) ? (doc as any).messages : [];
  // regenerate 模式不写入当前用户消息，因此不需要移除最后一条
  const historyBase = regenerate ? fullHistory : (fullHistory.length > 0 ? fullHistory.slice(0, -1) : []);
  const buildHistoryText = (list: any[]): string => {
    const items = list.slice(-MAX_HISTORY).filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'));
    return items.map((m: any) => `${m.role === 'user' ? '用户' : '助手'}: ${String(m.content ?? '')}`).join('\n');
  };
  const historyText = buildHistoryText(historyBase);
  // 归一化 Responses 输入为消息数组，并注入历史摘要（作为一条用户消息文本）
  const buildResponsesInputWithHistory = (src: string | any[]): any[] => {
    const dev = { role: 'developer', content: [{ type: 'input_text', text: '总是用中文回复' }] } as any;
    const historyMsg = historyText ? { role: 'user', content: [{ type: 'input_text', text: `以下是对话历史（供参考）：\n${historyText}` }] } as any : null;
    const current = Array.isArray(src)
      ? src
      : [{ role: 'user', content: [{ type: 'input_text', text: String(src ?? '') }] }] as any[];
    return [dev, ...(historyMsg ? [historyMsg] : []), ...current];
  };

  // Responses 固定为 gpt-5
  const apiModelStream = 'gpt-5';
  // 可选：联网搜索（仅由用户开关决定）
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
            encoder.encode(`data: ${JSON.stringify({ type: 'start', requestId, route: 'responses', model: modelToUse })}\n\n`)
          );

          // 构建 Responses 请求
          const finalSettings: any = {};
          const selectedEffort = (settings?.reasoning?.effort || 'high') as any;
          finalSettings.reasoning = {
            ...(settings?.reasoning || {}),
            effort: selectedEffort,
          };
          if (typeof settings?.text?.verbosity === 'string') {
            finalSettings.verbosity = settings.text.verbosity;
          }
          if (typeof settings?.verbosity === 'string') {
            finalSettings.verbosity = settings.verbosity;
          }

          let inputPayload = buildResponsesInputWithHistory(input);
          if (injectedHistoryMsg) {
            const dev = inputPayload.shift();
            inputPayload = [dev, injectedHistoryMsg, ...inputPayload];
          }
          const maxOutputTokens = typeof settings?.maxTokens === 'number' ? settings.maxTokens : undefined;

          const reqPayloadStream: any = {
            model: apiModelStream,
            input: inputPayload,
            stream: true,
            ...(typeof maxOutputTokens === 'number' ? { max_output_tokens: maxOutputTokens } : {}),
            reasoning: finalSettings.reasoning,
            ...(finalSettings.verbosity ? { text: { verbosity: finalSettings.verbosity } } : {}),
          };

          const response = await (ai as any).responses.create(reqPayloadStream);

          if (searchUsed) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'search', used: true })}\n\n`));
            if (Array.isArray(searchSources) && searchSources.length > 0) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'search_sources', sources: searchSources })}\n\n`)
              );
            }
          }
          let fullContent = '';
          for await (const event of response) {
            if (event.type === 'response.refusal.delta') continue;
            if (event.type === 'response.output_text.delta') {
              fullContent += event.delta || '';
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'content', content: event.delta })}\n\n`)
              );
            } else if (event.type === 'response.reasoning.delta') {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'reasoning', content: event.delta })}\n\n`)
              );
            } else if (event.type === 'response.completed') {
              try {
                await Conversation.updateOne(
                  { id: conversationId, userId: user.sub },
                  {
                    $push: {
                      messages: {
                        id: Date.now().toString(36),
                        role: 'assistant',
                        content: fullContent,
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
            }
          }
        } catch (e: any) {
          console.error('[GPT-5] 流式请求失败:', e?.message || String(e));
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
  return new Response(JSON.stringify({ error: '仅支持流式输出' }), { status: 400 });
}