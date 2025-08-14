import { NextRequest, NextResponse } from 'next/server';
import { 
  createResponse, 
  executeFunction, 
  PREDEFINED_TOOLS,
  validateModelFeature,
  formatImageInput 
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
  const requestId = Math.random().toString(36).substring(7);
  console.log(`🎯 [Responses API ${requestId}] 收到新请求`);

  try {
    // 验证环境变量
    validateEnvVars();
    console.log(`✅ [Responses API ${requestId}] 环境变量验证通过`);

    const body = await request.json();
    console.log(`📋 [Responses API ${requestId}] 请求体:`, JSON.stringify(body, null, 2));

    const {
      conversationId,
      input,
      instructions,
      model,
      settings = {},
      useTools = false,
      stream = false
    } = body;

    console.log(`🔍 [Responses API ${requestId}] 解析参数:`, {
      conversationId,
      inputType: typeof input,
      inputPreview: typeof input === 'string' ? input.substring(0, 100) + '...' : input,
      model,
      settings,
      useTools,
      stream
    });

    // 验证必需参数
    if (!input || !model) {
      console.log(`❌ [Responses API ${requestId}] 缺少必需参数`);
      return NextResponse.json(
        { error: '缺少必需参数：input 和 model' },
        { status: 400 }
      );
    }

    // 验证模型
    if (!MODELS[model as ModelId]) {
      console.log(`❌ [Responses API ${requestId}] 不支持的模型: ${model}`);
      return NextResponse.json(
        { error: `不支持的模型：${model}` },
        { status: 400 }
      );
    }

    const modelId = model as ModelId;
    const modelConfig = MODELS[modelId];
    console.log(`✅ [Responses API ${requestId}] 模型验证通过:`, { modelId, modelConfig });

    // 检查模型类型
    if (modelConfig.type !== 'responses') {
      console.log(`❌ [Responses API ${requestId}] 模型类型不匹配: ${modelConfig.type}`);
      return NextResponse.json(
        { error: `模型 ${model} 不支持 Responses API，请使用 Chat Completions API` },
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
      let title = '新对话';
      if (typeof input === 'string') {
        title = input.substring(0, 50) + (input.length > 50 ? '...' : '');
      } else if (Array.isArray(input)) {
        const textInput = input.find(item => item.type === 'input_text');
        if (textInput && textInput.text) {
          title = textInput.text.substring(0, 50) + (textInput.text.length > 50 ? '...' : '');
        }
      }
      conversation = await createConversation(title, modelId, settings, auth.sub);
    }

    // 添加用户消息到数据库
    let userContent: string;
    let userImages: string[] = [];

    if (typeof input === 'string') {
      userContent = input;
    } else if (Array.isArray(input)) {
      // 处理数组格式的输入（包含文本和图像）
      const textInput = input.find(item => item.type === 'input_text');
      const imageInputs = input.filter(item => item.type === 'input_image');

      userContent = textInput ? textInput.text : '';
      userImages = imageInputs.map(item => item.image_url);
    } else {
      userContent = JSON.stringify(input);
    }

    const userMessage: Omit<Message, 'id' | 'timestamp'> = {
      role: 'user',
      content: userContent,
      model: modelId,
      ...(userImages.length > 0 && { images: userImages }),
    };

    await addMessageToConversation(conversation.id, userMessage, auth.sub);

    // 准备工具
    const tools = useTools && validateModelFeature(modelId, 'tools') ? PREDEFINED_TOOLS : undefined;

    // 调用 OpenAI Responses API
    console.log(`🚀 [Responses API ${requestId}] 调用 createResponse...`);
    const response = await createResponse({
      model: modelId,
      input,
      instructions,
      settings,
      tools,
      stream,
    });
    const actualModel = (response as any).model || modelId;
    console.log(`✅ [Responses API ${requestId}] createResponse 调用完成，实际模型: ${actualModel}`);

    if (stream) {
      console.log(`🌊 [Responses API ${requestId}] 开始处理流式响应`);
      // 流式响应
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            let assistantMessage = '';
            let reasoning = '';
            let functionCalls: any[] = [];
            let eventCount = 0;

            console.log(`🔄 [Responses API ${requestId}] 开始迭代响应事件`);

            for await (const event of response as any) {
              eventCount++;
              console.log(`📨 [Responses API ${requestId}] 事件 #${eventCount}:`, {
                type: event.type,
                hasContent: !!event.content,
                hasDelta: !!event.delta,
                eventKeys: Object.keys(event)
              });

              // 处理不同类型的事件（兼容 OpenAI Responses API 各版本命名）
              // 开始类事件
              if (
                event.type === 'content.start' ||
                event.type === 'response.created' ||
                event.type === 'response.in_progress' ||
                event.type === 'response.output_item.added'
              ) {
                console.log(`🎬 [Responses API ${requestId}] 内容开始/进行中:`, event.type);
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'start' })}\n\n`)
                );
              }

              // 文本增量事件
              if (
                event.type === 'content.delta' ||
                event.type === 'response.output_text.delta'
              ) {
                const piece = typeof event.delta === 'string'
                  ? event.delta
                  : (event?.delta?.text ?? event?.delta?.content ?? '');
                if (piece) {
                  assistantMessage += piece;
                  console.log(`📝 [Responses API ${requestId}] 内容增量(${event.type}):`, piece.substring(0, 50) + '...');
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'content', content: piece })}\n\n`)
                  );
                }
              }

              // 推理增量事件
              if (
                event.type === 'reasoning.delta' ||
                event.type === 'response.reasoning.delta'
              ) {
                const r = typeof event.delta === 'string'
                  ? event.delta
                  : (event?.delta?.text ?? event?.delta?.content ?? '');
                if (r) {
                  reasoning += r;
                  console.log(`🤔 [Responses API ${requestId}] 推理增量(${event.type}):`, r.substring(0, 50) + '...');
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify({ type: 'reasoning', content: r })}\n\n`)
                  );
                }
              }

              // 工具调用事件（向后兼容）
              if (event.type === 'tool_call.start') {
                console.log(`🔧 [Responses API ${requestId}] 工具调用开始:`, event.tool_call?.name);
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'tool_call_start', tool: event.tool_call?.name })}\n\n`)
                );
              }

              if (event.type === 'tool_call.result') {
                console.log(`🔧 [Responses API ${requestId}] 执行工具:`, event.tool_call?.name, '参数:', event.tool_call?.arguments);
                const result = await executeFunction(
                  event.tool_call?.name,
                  event.tool_call?.arguments
                );
                console.log(`✅ [Responses API ${requestId}] 工具执行结果:`, result);
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'tool_result', tool: event.tool_call?.name, result })}\n\n`)
                );
              }

              // 结束类事件
              if (
                event.type === 'done' ||
                event.type === 'response.completed'
              ) {
                console.log(`🏁 [Responses API ${requestId}] 流式响应完成:`, event.type);
                console.log(`📊 [Responses API ${requestId}] 最终统计:`, {
                  totalEvents: eventCount,
                  messageLength: assistantMessage.length,
                  reasoningLength: reasoning.length,
                  functionCallsCount: functionCalls.length
                });

                // 保存助手消息到数据库
                const assistantMsg: Omit<Message, 'id' | 'timestamp'> = {
                  role: 'assistant',
                  content: assistantMessage,
                  model: actualModel,
                  metadata: {
                    reasoning: reasoning || undefined,
                    verbosity: settings.text?.verbosity,
                    effort: settings.reasoning?.effort,
                  },
                };

                console.log(`💾 [Responses API ${requestId}] 保存助手消息到数据库...`);
                await addMessageToConversation(conversation.id, assistantMsg, auth.sub);
                console.log(`✅ [Responses API ${requestId}] 消息保存成功`);

                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ type: 'done', conversationId: conversation.id, reasoning: reasoning || undefined })}\n\n`)
                );
                controller.close();
              }
            }

            console.log(`🔚 [Responses API ${requestId}] 事件迭代结束，总计 ${eventCount} 个事件`);
          } catch (error) {
            console.error(`❌ [Responses API ${requestId}] 流处理错误:`, error);
            const errInfo = error instanceof Error ? {
              name: error.name,
              message: error.message,
              stack: error.stack
            } : {
              name: 'Unknown',
              message: String(error),
              stack: undefined
            };
            console.error(`❌ [Responses API ${requestId}] 错误详情:`, errInfo);
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                type: 'error',
                error: '处理响应时出错',
                details: errInfo.message
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
      console.log(`📄 [Responses API ${requestId}] 处理非流式响应`);
      // 非流式响应
      const result = response as any;
      console.log(`📥 [Responses API ${requestId}] 原始响应:`, JSON.stringify(result, null, 2));

      let assistantContent = result.content || result.output || '';
      let reasoning = result.reasoning || '';

      console.log(`📝 [Responses API ${requestId}] 解析内容:`, {
        contentLength: assistantContent.length,
        reasoningLength: reasoning.length,
        hasToolCalls: !!(result.tool_calls && result.tool_calls.length > 0),
        usage: result.usage
      });

      // 处理工具调用
      if (result.tool_calls && result.tool_calls.length > 0) {
        console.log(`🔧 [Responses API ${requestId}] 处理 ${result.tool_calls.length} 个工具调用`);
        for (const toolCall of result.tool_calls) {
          console.log(`🔧 [Responses API ${requestId}] 执行工具:`, toolCall.name, '参数:', toolCall.arguments);
          const toolResult = await executeFunction(toolCall.name, toolCall.arguments);
          console.log(`✅ [Responses API ${requestId}] 工具执行结果:`, toolResult);
          assistantContent += `\n\n工具调用结果（${toolCall.name}）：${toolResult}`;
        }
      }

      // 保存助手消息到数据库
      const assistantMessage: Omit<Message, 'id' | 'timestamp'> = {
        role: 'assistant',
        content: assistantContent,
        model: actualModel,
        metadata: {
          reasoning: reasoning || undefined,
          verbosity: settings.text?.verbosity,
          effort: settings.reasoning?.effort,
          tokensUsed: result.usage?.total_tokens,
        },
      };

      console.log(`💾 [Responses API ${requestId}] 保存助手消息到数据库...`);
      await addMessageToConversation(conversation.id, assistantMessage, auth.sub);
      console.log(`✅ [Responses API ${requestId}] 消息保存成功`);

      const responseData = {
        message: assistantMessage,
        conversationId: conversation.id,
        reasoning: reasoning || undefined,
        usage: result.usage,
      };

      console.log(`🎯 [Responses API ${requestId}] 返回响应:`, {
        messageLength: assistantMessage.content.length,
        conversationId: conversation.id,
        hasReasoning: !!reasoning,
        tokensUsed: result.usage?.total_tokens
      });

      return NextResponse.json(responseData);
    }
  } catch (error) {
    console.error(`❌ [Responses API ${requestId}] 总体错误:`, error);

    const errInfo = error instanceof Error ? {
      name: error.name,
      message: error.message,
      status: (error as any).status,
      code: (error as any).code,
      type: (error as any).type,
      stack: error.stack
    } : {
      name: 'Unknown',
      message: String(error),
      status: undefined,
      code: undefined,
      type: undefined,
      stack: undefined
    };

    console.error(`❌ [Responses API ${requestId}] 错误详情:`, errInfo);

    return NextResponse.json(
      {
        error: '处理请求时出错，请稍后重试',
        details: errInfo.message,
        requestId
      },
      { status: 500 }
    );
  }
}
