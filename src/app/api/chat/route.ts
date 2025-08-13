import { NextRequest, NextResponse } from 'next/server';
import { 
  createChatCompletion, 
  executeFunction, 
  PREDEFINED_TOOLS,
  validateModelFeature 
} from '@/lib/openai';
import { 
  addMessageToConversation, 
  getConversation, 
  createConversation 
} from '@/lib/mongodb';
import { ModelId, MODELS, Message } from '@/lib/types';
import { generateId, validateEnvVars } from '@/utils/helpers';
import { getAuthUserFromRequest } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    // 验证环境变量
    validateEnvVars();

    const body = await request.json();
    const { 
      conversationId, 
      message, 
      model, 
      settings = {},
      useTools = false,
      stream = false 
    } = body;

    // 验证必需参数
    if (!message || !model) {
      return NextResponse.json(
        { error: '缺少必需参数：message 和 model' },
        { status: 400 }
      );
    }

    // 验证模型
    if (!MODELS[model as ModelId]) {
      return NextResponse.json(
        { error: `不支持的模型：${model}` },
        { status: 400 }
      );
    }

    const modelId = model as ModelId;
    const modelConfig = MODELS[modelId];

    // 检查模型类型
    if (modelConfig.type !== 'chat') {
      return NextResponse.json(
        { error: `模型 ${model} 不支持 Chat Completions API，请使用 Responses API` },
        { status: 400 }
      );
    }

    // 身份校验
    const auth = getAuthUserFromRequest(request);
    if (!auth) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    // 获取或创建对话
    let conversation;
    if (conversationId) {
      conversation = await getConversation(conversationId, auth.sub);
      if (!conversation) {
        return NextResponse.json(
          { error: '对话不存在' },
          { status: 404 }
        );
      }
    } else {
      // 创建新对话
      const title = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '');
      conversation = await createConversation(title, modelId, settings, auth.sub);
    }

    // 添加用户消息到数据库
    const userMessage: Omit<Message, 'id' | 'timestamp'> = {
      role: 'user',
      content: message.content,
      model: modelId,
      images: message.images || [],
    };

    await addMessageToConversation(conversation.id, userMessage, auth.sub);

    // 准备消息历史
    const messages = [
      ...conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content,
        ...(msg.images && msg.images.length > 0 && validateModelFeature(modelId, 'vision') ? {
          content: [
            { type: 'text', text: msg.content },
            ...msg.images.map(img => ({
              type: 'image_url',
              image_url: { url: img }
            }))
          ]
        } : {})
      })),
      {
        role: 'user',
        content: message.images && message.images.length > 0 && validateModelFeature(modelId, 'vision') 
          ? [
              { type: 'text', text: message.content },
              ...message.images.map((img: string) => ({
                type: 'image_url',
                image_url: { url: img }
              }))
            ]
          : message.content
      }
    ];

    // 准备工具
    const tools = useTools && validateModelFeature(modelId, 'tools') ? PREDEFINED_TOOLS : undefined;

    // 调用 OpenAI API
    const completion = await createChatCompletion({
      model: modelId,
      messages,
      settings,
      tools,
      stream,
    });

    if (stream) {
      // 流式响应
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            let assistantMessage = '';
            let functionCalls: any[] = [];

            for await (const chunk of completion as any) {
              const delta = chunk.choices[0]?.delta;
              
              if (delta?.content) {
                assistantMessage += delta.content;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: 'content', 
                    content: delta.content 
                  })}\n\n`)
                );
              }

              if (delta?.function_call) {
                functionCalls.push(delta.function_call);
              }

              if (chunk.choices[0]?.finish_reason === 'stop') {
                // 保存助手消息到数据库
                const assistantMsg: Omit<Message, 'id' | 'timestamp'> = {
                  role: 'assistant',
                  content: assistantMessage,
                  model: modelId,
                };

                await addMessageToConversation(conversation.id, assistantMsg, auth.sub);

                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ 
                    type: 'done',
                    conversationId: conversation.id
                  })}\n\n`)
                );
                controller.close();
              }

              if (chunk.choices[0]?.finish_reason === 'function_call') {
                // 处理函数调用
                const functionCall = functionCalls[functionCalls.length - 1];
                if (functionCall) {
                  const result = await executeFunction(
                    functionCall.name, 
                    JSON.parse(functionCall.arguments)
                  );

                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ 
                      type: 'function_result',
                      function: functionCall.name,
                      result
                    })}\n\n`)
                  );
                }
              }
            }
          } catch (error) {
            console.error('Stream error:', error);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ 
                type: 'error', 
                error: '处理响应时出错' 
              })}\n\n`)
            );
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    } else {
      // 非流式响应
      const choice = (completion as any).choices[0];
      let assistantContent = choice.message.content;
      let functionResult = null;

      // 处理函数调用
      if (choice.message.function_call) {
        const { name, arguments: args } = choice.message.function_call;
        functionResult = await executeFunction(name, JSON.parse(args));
        assistantContent += `\n\n函数调用结果：${functionResult}`;
      }

      // 保存助手消息到数据库
      const assistantMessage: Omit<Message, 'id' | 'timestamp'> = {
        role: 'assistant',
        content: assistantContent,
        model: modelId,
        ...(choice.message.function_call ? {
          functionCall: choice.message.function_call,
          functionResult: functionResult ? {
            name: choice.message.function_call.name,
            result: functionResult,
          } : undefined,
        } : {}),
        metadata: {
          tokensUsed: (completion as any).usage?.total_tokens,
        },
      };

      await addMessageToConversation(conversation.id, assistantMessage, auth.sub);

      return NextResponse.json({
        message: assistantMessage,
        conversationId: conversation.id,
        usage: (completion as any).usage,
      });
    }
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: '处理请求时出错，请稍后重试' },
      { status: 500 }
    );
  }
}
