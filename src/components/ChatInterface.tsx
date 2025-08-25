'use client';

import { useState, useEffect, useCallback } from 'react';
import { useChatStore } from '@/store/chatStore';
import { MODELS } from '@/lib/types';
import { generateId, generateTitleFromMessage } from '@/utils/helpers';
import { createConversationAction } from '@/app/actions/conversations';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import ModelSelector from './ModelSelector';
import SettingsPanel from './SettingsPanel';

export default function ChatInterface() {
  const {
    currentConversation,
    setCurrentConversation,
    addConversation,
    addMessage,
    currentModel,
    settings,
    isStreaming,
    setStreaming,
    setError,
  } = useChatStore();

  const [streamingContent, setStreamingContent] = useState('');
  const [reasoningContent, setReasoningContent] = useState('');

  const modelConfig = MODELS[currentModel];

  // 发送消息
  const handleSendMessage = useCallback(async (content: string, images?: string[]) => {
    try {
      setError(null);
      setStreaming(true);
      setStreamingContent('');
      setReasoningContent('');

      // 创建用户消息
      const userMessage = {
        id: generateId(),
        role: 'user' as const,
        content,
        timestamp: new Date(),
        model: currentModel,
        images,
      };

      // 如果没有当前对话，创建新对话
      let conversationId = currentConversation?.id;
      if (!conversationId) {
        const title = generateTitleFromMessage(content);
        const newConversation = await createConversationAction({
          title,
          model: currentModel,
          settings,
        } as any);
        setCurrentConversation(newConversation);
        addConversation(newConversation);
        conversationId = newConversation.id;
      }

      // 添加用户消息到界面
      addMessage(userMessage);

      // 准备 API 请求
      const apiEndpoint = modelConfig.type === 'responses' ? '/api/responses' : '/api/chat';

      let requestBody: any;
      if (modelConfig.type === 'responses') {
        // 对于 Responses API，需要正确格式化 input 参数
        let input: string | any[];
        if (images && images.length > 0) {
          // 如果有图像，使用数组格式
          input = [
            {
              type: 'input_text',
              text: content,
            },
            ...images.map(imageUrl => ({
              type: 'input_image',
              image_url: imageUrl,
            })),
          ];
        } else {
          // 如果只有文本，使用字符串格式
          input = content;
        }

        requestBody = {
          conversationId,
          input,
          model: currentModel,
          settings,
          useTools: true,
          stream: settings.stream !== false,
        };
      } else {
        // 对于 Chat API，保持原有格式
        requestBody = {
          conversationId,
          message: {
            content,
            images,
          },
          model: currentModel,
          settings,
          useTools: true,
          stream: settings.stream !== false,
        };
      }

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ [ChatInterface] 请求失败:', errorData);
        throw new Error(errorData.error || '请求失败');
      }

      const contentType = response.headers.get('Content-Type') || '';
      const canStream = settings.stream !== false && contentType.includes('text/event-stream');

      if (canStream) {
        // 处理流式响应
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          console.error('❌ [ChatInterface] 无法获取响应流读取器');
          throw new Error('无法读取响应流');
        }

        let assistantContent = '';
        let reasoning = '';
        let chunkCount = 0;
        let routedModel: string | null = null;
        let routedEffort: string | undefined = undefined;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value);

          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                switch (data.type) {
                  case 'content':
                    assistantContent += data.content;
                    setStreamingContent(assistantContent);
                    break;

                  case 'reasoning':
                    reasoning += data.content;
                    setReasoningContent(reasoning);
                    break;

                  case 'routing':
                    routedModel = data.model;
                    routedEffort = data.effort;
                    const verbosity = data.verbosity as 'low' | 'medium' | 'high' | undefined;
                    if (routedEffort && verbosity) {
                      console.info('[Router] 使用模型: %s, effort=%s, verbosity=%s, requestId=%s', routedModel, routedEffort, verbosity, data.requestId);
                    } else if (routedEffort) {
                      console.info('[Router] 使用模型: %s, effort=%s, requestId=%s', routedModel, routedEffort, data.requestId);
                    } else if (verbosity) {
                      console.info('[Router] 使用模型: %s, verbosity=%s, requestId=%s', routedModel, verbosity, data.requestId);
                    } else {
                      console.info('[Router] 使用模型: %s, requestId=%s', routedModel, data.requestId);
                    }
                    break;

                  case 'start':
                  case 'tool_call_start':
                    // 起始事件或工具调用开始事件，无需特殊处理
                    break;

                  case 'function_result':
                  case 'tool_result':
                    assistantContent += `\n\n**工具调用结果 (${data.tool || data.function}):**\n${data.result}`;
                    setStreamingContent(assistantContent);
                    break;

                  case 'done':
                    // 添加助手消息到界面
                    const assistantMessage = {
                      id: generateId(),
                      role: 'assistant' as const,
                      content: assistantContent,
                      timestamp: new Date(),
                      model: routedModel || currentModel,
                      metadata: {
                        reasoning: reasoning || undefined,
                        verbosity: settings.text?.verbosity,
                      },
                    };
                    addMessage(assistantMessage);
                    // 归一化路由日志（done 时若未提前收到 routing 事件，则以当前模型作为兜底）
                    console.info('[Router] 模型已完成响应。model=%s', assistantMessage.model);
                    setStreamingContent('');
                    setReasoningContent('');
                    break;

                  case 'error':
                    console.error('❌ [ChatInterface] 流式响应错误:', data.error, data.details);
                    throw new Error(data.error);

                  default:
                    console.warn(`❓ [ChatInterface] 未知事件类型:`, data.type, data);
                }
              } catch (parseError) {
                console.error('❌ [ChatInterface] JSON 解析错误:', parseError, '原始行:', line);
              }
            }
          }
        }
      } else {
        // 处理非流式响应
        const data = await response.json();

        if (data.message) {
          addMessage({
            ...data.message,
            id: generateId(),
            timestamp: new Date(),
          });
          const routing = data.routing;
          if (routing) {
            if (routing.effort && routing.verbosity) {
              console.info('[Router] 使用模型: %s, effort=%s, verbosity=%s', routing.model, routing.effort, routing.verbosity);
            } else if (routing.effort) {
              console.info('[Router] 使用模型: %s, effort=%s', routing.model, routing.effort);
            } else if (routing.verbosity) {
              console.info('[Router] 使用模型: %s, verbosity=%s', routing.model, routing.verbosity);
            } else {
              console.info('[Router] 使用模型: %s', routing.model);
            }
          } else if (data.message?.model) {
            console.info('[Router] 使用模型: %s', data.message.model);
          }
        }
      }
    } catch (error) {
      console.error('❌ [ChatInterface] 发送消息失败:', error);
      const errInfo = error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : {
        name: 'Unknown',
        message: String(error),
        stack: undefined
      };
      console.error('❌ [ChatInterface] 错误详情:', errInfo);
      setError(error instanceof Error ? error.message : '发送消息失败');
    } finally {
      setStreaming(false);
      setStreamingContent('');
      setReasoningContent('');
    }
  }, [
    currentConversation,
    currentModel,
    settings,
    setCurrentConversation,
    addConversation,
    addMessage,
    setStreaming,
    setError,
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* 头部 */}
      <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold">
              {currentConversation?.title || '新对话'}
            </h1>
            {currentConversation && (
              <span className="text-sm text-muted-foreground">
                {currentConversation.messages.length} 条消息
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="w-64">
              <ModelSelector />
            </div>
          </div>
        </div>
      </div>

      {/* 消息列表 */}
      <MessageList
        messages={currentConversation?.messages || []}
        isStreaming={isStreaming}
        streamingContent={streamingContent}
        reasoningContent={reasoningContent}
      />

      {/* 输入区域 */}
      <div className="border-t border-border bg-background p-4">
        <div className="mx-auto max-w-4xl">
          <MessageInput
            onSendMessage={handleSendMessage}
            disabled={isStreaming}
          />
        </div>
      </div>

      {/* 设置面板 */}
      <SettingsPanel />
    </div>
  );
}
