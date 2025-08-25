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
        // Responses API 入参：
        // - 纯文本：input 直接用 string
        // - 图文：input 为 [{ role:'user', content: [ {type:'input_text'}, {type:'input_image'}... ] }]
        let input: string | any[];
        if (images && images.length > 0) {
          input = [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: content },
                ...images.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl })),
              ],
            },
          ];
        } else {
          input = content;
        }

        requestBody = {
          conversationId,
          input,
          model: currentModel,
          settings,
          useTools: true,
          stream: true,
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
          stream: true,
        };
      }

      let response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '请求失败');
      }

      const contentType = response.headers.get('Content-Type') || '';
      const canStream = contentType.includes('text/event-stream');

      if (canStream) {
        // 处理流式响应
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
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
                    // 运行日志已在服务端记录
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
                    // 运行日志已在服务端记录
                    setStreamingContent('');
                    setReasoningContent('');
                    break;

                  case 'error':
                    // 降级为非流式请求
                    try {
                      const fallbackBody = { ...requestBody, stream: false } as any;
                      const fallbackResp = await fetch(apiEndpoint, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(fallbackBody),
                        credentials: 'include',
                      });
                      if (fallbackResp.ok) {
                        const dataJson = await fallbackResp.json();
                        if (dataJson.message) {
                          addMessage({
                            ...dataJson.message,
                            id: generateId(),
                            timestamp: new Date(),
                          });
                        }
                        setStreamingContent('');
                        setReasoningContent('');
                        return; // 直接结束循环
                      }
                    } catch {}
                    throw new Error(data.error);

                  default:
                    // 忽略未知事件类型
                }
              } catch (parseError) {
                // 忽略解析错误
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
          // 运行日志已在服务端记录
        }
      }
    } catch (error) {
      const errInfo = error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : {
        name: 'Unknown',
        message: String(error),
        stack: undefined
      };
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
      {/* 顶栏：当没有对话时隐藏，保持与 ChatGPT 一致的沉浸式首页 */}
      {currentConversation && (
        <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between px-4 py-3">
            {/* 左侧：模型切换（ghost 变体） */}
            <div className="flex items-center gap-3">
              <ModelSelector variant="ghost" />
            </div>

            {/* 中间：思考提示（占位 pill）*/}
            <div className="flex-1 flex items-center justify-center">
              {isStreaming ? (
                <div className="flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
                  <span>正在思考</span>
                  <span className="loading-dots" />
                  <button className="ml-2 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent" disabled>
                    跳过
                  </button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">{currentConversation?.title}</div>
              )}
            </div>

            {/* 右侧：占位按钮（不可点击）*/}
            <div className="flex items-center gap-2 text-muted-foreground">
              <button className="rounded-full border px-3 py-1 text-xs" disabled>分享</button>
              <button className="rounded-full border px-3 py-1 text-xs" disabled>重命名</button>
              <button className="rounded-full border px-3 py-1 text-xs" disabled>更多</button>
            </div>
          </div>
        </div>
      )}

      {/* 主体区域 */}
      {(!currentConversation || currentConversation.messages.length === 0) ? (
        // 首页空状态（仿 ChatGPT）
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">您在忙什么？</h1>
              <p className="mt-2 text-sm text-muted-foreground">输入问题或指令，开始与智能助手对话</p>
            </div>
            <div className="w-full">
              <MessageInput
                onSendMessage={handleSendMessage}
                disabled={isStreaming}
                variant="center"
                autoFocus
              />
            </div>
            <div className="text-xs text-muted-foreground">ChatGPT 可能会出错，请核查重要信息。</div>
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

      {/* 设置面板 */}
      <SettingsPanel />
    </div>
  );
}
