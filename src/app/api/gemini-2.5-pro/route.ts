// Gemini 2.5 Pro Chat API Route (基于官方指南结构)
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

// Gemini API 配置
const GEMINI_BASE_URL = 'https://aihubmix.com/gemini';
const MODEL_NAME = 'gemini-2.5-pro'; // 使用官方指南中的模型名

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
  try {
    console.log('[Gemini 2.5 Pro] route hit');
  } catch {}
  
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

  const { conversationId, input, model, settings, stream, regenerate } = body as {
    conversationId: string;
    input: string | any[];
    model: string;
    settings: any;
    stream?: boolean;
    regenerate?: boolean;
  };

  const apiKey = process.env.AIHUBMIX_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing AIHUBMIX_API_KEY' }), { status: 500 });
  }

  const Conversation = await getConversationModel();
  const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  
  try {
    const inputType = Array.isArray(input) ? 'array' : typeof input;
    const inputInfo = Array.isArray(input)
      ? { turns: input.length, firstTurnParts: (Array.isArray(input?.[0]?.content) ? input[0].content.length : 0) }
      : { textLen: String(input ?? '').length };
    console.log('[Gemini 2.5 Pro] request', JSON.stringify({ requestId, stream: !!stream, regenerate: !!regenerate, model, inputType, inputInfo }));
  } catch {}

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

  // 构建请求内容
  const contents = buildGeminiContents(input, historyText);
  
  // 构建生成配置（遵循官方指南的结构）
  const generationConfig: GenerateContentConfig = {};
  const systemInstruction: Content = {
    role: 'user',
    parts: [createTextPart('总是用中文回复')],
  };

  // 设置参数
  if (typeof settings?.maxTokens === 'number') {
    generationConfig.maxOutputTokens = settings.maxTokens;
  }

  if (typeof settings?.temperature === 'number') {
    generationConfig.temperature = settings.temperature;
  }
  

  // 检查是否包含多媒体内容
  const hasInlineData = contents.some(content =>
    content.parts.some(part => part.inlineData)
  );

  console.log('[Gemini 2.5 Pro] config', JSON.stringify({
    requestId,
    hasHistory: !!historyText,
    turns: contents.length,
    hasInlineData
  }));

  // 流式响应处理
  if (stream) {
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          // 发送开始事件
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ 
              type: 'start', 
              requestId, 
              route: 'gemini.generate_content', 
              model: MODEL_NAME 
            })}\n\n`)
          );

          // 构建请求 URL（追加 key 参数）
          const url = `${GEMINI_BASE_URL}/v1beta/models/${MODEL_NAME}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
          
          // 构建请求体（使用 camelCase 字段名，符合 Gemini v1beta REST 规范）
          const requestBody = {
            contents,
            generationConfig,
            systemInstruction,
          };

          // 发送请求
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream',
            },
            body: JSON.stringify(requestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('[Gemini 2.5 Pro] stream error', JSON.stringify({ 
              requestId, 
              status: response.status, 
              error: errorText 
            }));
            
                      controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                error: errorText || `Gemini 请求失败 (${response.status})` 
              })}\n\n`)
                    );
                    controller.close();
                    return;
                  }

          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          
          if (!reader) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                error: '无法读取响应流' 
              })}\n\n`)
            );
            controller.close();
            return;
          }

          let sseBuffer = '';
          let answerAccum = '';
          let thoughtAccum = '';
          let eventCount = 0;

          // 处理流式响应
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            sseBuffer += chunk.replace(/\r\n/g, '\n');

            // 解析 SSE 事件
            while (true) {
              const sepIndex = sseBuffer.indexOf('\n\n');
              if (sepIndex === -1) break;
              
              const block = sseBuffer.slice(0, sepIndex);
              sseBuffer = sseBuffer.slice(sepIndex + 2);

              try {
                const dataLines = block
                  .split('\n')
                  .filter(l => l.startsWith('data:'))
                  .map(l => l.slice(5).trimStart());
                
                if (dataLines.length === 0) continue;
                
                const payload = dataLines.join('\n');
                if (payload === '[DONE]' || payload === 'DONE') continue;
                
                const data = JSON.parse(payload);
                eventCount++;

                // 处理响应内容
                const parts = data?.candidates?.[0]?.content?.parts || [];
                if (Array.isArray(parts) && parts.length > 0) {
                  for (const part of parts) {
                    if (typeof part?.text === 'string') {
                      if (part.thought) {
                        // 思考过程
                        const delta = part.text;
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ 
                            type: 'reasoning', 
                            content: delta 
                          })}\n\n`)
                        );
                        thoughtAccum += delta;
                      } else {
                        // 正常内容
                        const delta = part.text;
                        controller.enqueue(
                          encoder.encode(`data: ${JSON.stringify({ 
                            type: 'content', 
                            content: delta 
                          })}\n\n`)
                        );
                        answerAccum += delta;
                      }
                    }
                  }
                }

                // 使用情况元数据
                if (data?.usageMetadata) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ 
                      type: 'debug', 
                      usage: data.usageMetadata 
                    })}\n\n`)
                  );
                  console.log('[Gemini 2.5 Pro] usage', JSON.stringify({ 
                    requestId, 
                    usage: data.usageMetadata 
                  }));
                }
              } catch (parseErr) {
                console.debug('[Gemini 2.5 Pro] parse error', parseErr);
              }
            }
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
                    metadata: thoughtAccum ? { reasoning: thoughtAccum } : undefined,
                  },
                },
                $set: { updatedAt: new Date() },
              }
            );

          console.log('[Gemini 2.5 Pro] stream done', JSON.stringify({ 
            requestId, 
            totalContentLen: answerAccum.length, 
            totalReasoningLen: thoughtAccum.length,
            events: eventCount 
          }));

          // 发送完成事件
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
          );
          controller.close();
        } catch (e: any) {
          console.error('[Gemini 2.5 Pro] stream failed', e?.message || String(e));
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ 
              type: 'error', 
              error: e?.message || 'Gemini 流式请求失败' 
            })}\n\n`)
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

  // 非流式响应处理
  try {
    const url = `${GEMINI_BASE_URL}/v1beta/models/${MODEL_NAME}:generateContent?key=${encodeURIComponent(apiKey)}`;
    console.log('[Gemini 2.5 Pro] non-stream request', JSON.stringify({ requestId, url }));

    const requestBody = {
      contents,
      generationConfig,
      systemInstruction,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Gemini 2.5 Pro] non-stream error', JSON.stringify({ 
        requestId, 
        status: response.status, 
        error: errorText 
      }));
      
      return new Response(
        JSON.stringify({ error: errorText || `Gemini 请求失败 (${response.status})` }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    
    // 提取响应内容
    let content = '';
    let reasoning = '';
    
    // 尝试直接获取文本
    if (data?.text) {
      content = data.text;
    } else if (data?.candidates?.[0]?.content?.parts) {
      // 从 parts 中提取
      for (const part of data.candidates[0].content.parts) {
        if (typeof part?.text === 'string') {
          if (part.thought) {
            reasoning += part.text;
          } else {
            content += part.text;
          }
        }
      }
    }

    console.log('[Gemini 2.5 Pro] extracted', JSON.stringify({ 
      requestId, 
      contentLen: content.length, 
      reasoningLen: reasoning.length,
      preview: content.slice(0, 120) 
    }));

    // 保存助手消息
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
            metadata: reasoning ? { reasoning } : undefined,
          },
      },
      $set: { updatedAt: new Date() },
    }
  );

  return Response.json(
    {
        message: { 
          role: 'assistant', 
          content, 
          model: MODEL_NAME,
          ...(reasoning ? { reasoning } : {})
        },
      requestId,
        usage: data?.usageMetadata,
      },
      { 
        headers: { 
          'X-Request-Id': requestId, 
          'X-Model': MODEL_NAME 
        } 
      }
    );
  } catch (e: any) {
    console.error('[Gemini 2.5 Pro] 请求失败:', e?.message || String(e));
    return new Response(
      JSON.stringify({ error: e?.message || 'Gemini 请求失败' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
