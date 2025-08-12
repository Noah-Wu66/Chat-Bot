'use client';

import { useState, useEffect, useCallback } from 'react';
import { useChatStore } from '@/store/chatStore';
import { MODELS } from '@/lib/types';
import { generateId, generateTitleFromMessage } from '@/utils/helpers';
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
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            model: currentModel,
            settings,
          }),
        });

        if (!response.ok) {
          throw new Error('创建对话失败');
        }

        const newConversation = await response.json();
        setCurrentConversation(newConversation);
        addConversation(newConversation);
        conversationId = newConversation.id;
      }

      // 添加用户消息到界面
      addMessage(userMessage);

      // 准备 API 请求
      const apiEndpoint = modelConfig.type === 'responses' ? '/api/responses' : '/api/chat';
      const requestBody = {
        conversationId,
        [modelConfig.type === 'responses' ? 'input' : 'message']: {
          content,
          images,
        },
        model: currentModel,
        settings,
        useTools: true,
        stream: settings.stream !== false,
      };

      // 发送请求
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '请求失败');
      }

      if (settings.stream !== false) {
        // 处理流式响应
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();

        if (!reader) {
          throw new Error('无法读取响应流');
        }

        let assistantContent = '';
        let reasoning = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

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
                      model: currentModel,
                      metadata: {
                        reasoning: reasoning || undefined,
                        verbosity: settings.text?.verbosity,
                        effort: settings.reasoning?.effort,
                      },
                    };
                    addMessage(assistantMessage);
                    setStreamingContent('');
                    setReasoningContent('');
                    break;

                  case 'error':
                    throw new Error(data.error);
                }
              } catch (parseError) {
                console.error('解析流数据失败:', parseError);
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
        }
      }
    } catch (error) {
      console.error('发送消息失败:', error);
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
