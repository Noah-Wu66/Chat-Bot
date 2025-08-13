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

      // 发送请求
      console.log('🚀 [ChatInterface] 发送请求:', {
        apiEndpoint,
        model: currentModel,
        requestBodyKeys: Object.keys(requestBody),
        stream: settings.stream !== false
      });
      console.log('📋 [ChatInterface] 请求体:', JSON.stringify(requestBody, null, 2));

      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      console.log('📡 [ChatInterface] 响应状态:', response.status, response.statusText);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ [ChatInterface] 请求失败:', errorData);
        throw new Error(errorData.error || '请求失败');
      }

      if (settings.stream !== false) {
        console.log('🌊 [ChatInterface] 开始处理流式响应');
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

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            console.log('🏁 [ChatInterface] 流式响应结束，总计处理', chunkCount, '个数据块');
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value);
          console.log(`📦 [ChatInterface] 数据块 #${chunkCount}:`, chunk.substring(0, 100) + '...');

          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                console.log(`📨 [ChatInterface] 解析事件:`, data.type, data);

                switch (data.type) {
                  case 'content':
                    assistantContent += data.content;
                    setStreamingContent(assistantContent);
                    console.log(`📝 [ChatInterface] 内容更新，总长度:`, assistantContent.length);
                    break;

                  case 'reasoning':
                    reasoning += data.content;
                    setReasoningContent(reasoning);
                    console.log(`🧠 [ChatInterface] 推理更新，总长度:`, reasoning.length);
                    break;

                  case 'function_result':
                  case 'tool_result':
                    console.log(`🔧 [ChatInterface] 工具调用结果:`, data.tool || data.function, data.result);
                    assistantContent += `\n\n**工具调用结果 (${data.tool || data.function}):**\n${data.result}`;
                    setStreamingContent(assistantContent);
                    break;

                  case 'done':
                    console.log(`🏁 [ChatInterface] 响应完成:`, {
                      contentLength: assistantContent.length,
                      reasoningLength: reasoning.length,
                      conversationId: data.conversationId
                    });
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
                    console.error('❌ [ChatInterface] 流式响应错误:', data.error, data.details);
                    throw new Error(data.error);

                  default:
                    console.log(`❓ [ChatInterface] 未知事件类型:`, data.type, data);
                }
              } catch (parseError) {
                console.error('❌ [ChatInterface] JSON 解析错误:', parseError, '原始行:', line);
                console.error('解析流数据失败:', parseError);
              }
            }
          }
        }
      } else {
        console.log('📄 [ChatInterface] 处理非流式响应');
        // 处理非流式响应
        const data = await response.json();
        console.log('📥 [ChatInterface] 非流式响应数据:', data);

        if (data.message) {
          console.log('✅ [ChatInterface] 添加助手消息:', {
            contentLength: data.message.content.length,
            hasReasoning: !!data.message.metadata?.reasoning,
            tokensUsed: data.message.metadata?.tokensUsed
          });
          addMessage({
            ...data.message,
            id: generateId(),
            timestamp: new Date(),
          });
        } else {
          console.warn('⚠️ [ChatInterface] 响应中没有消息数据');
        }
      }
    } catch (error) {
      console.error('❌ [ChatInterface] 发送消息失败:', error);
      console.error('❌ [ChatInterface] 错误详情:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      setError(error instanceof Error ? error.message : '发送消息失败');
    } finally {
      console.log('🔄 [ChatInterface] 清理状态');
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
