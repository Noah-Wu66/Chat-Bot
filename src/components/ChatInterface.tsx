'use client';

import { useState, useCallback } from 'react';
import { useChatStore } from '@/store/chatStore';
import { MODELS } from '@/lib/types';
import { generateId, generateTitleFromMessage } from '@/utils/helpers';
import { createConversationAction } from '@/app/actions/conversations';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
// 删除顶部来源条相关导入
import ModelSelector from './ModelSelector';
import UserPanel from './UserPanel';
import LoginModal from './LoginModal';

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
  // 已移除顶部来源条，不再在此维护来源弹窗状态
  const { webSearchEnabled } = useChatStore();


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

      // 如果没有当前对话，或当前对话模型与所选模型不一致，则创建新对话，并确保本地立即包含首条用户消息
      let conversationId = currentConversation?.id;
      if (!conversationId || currentConversation?.model !== currentModel) {
        const title = generateTitleFromMessage(content);
        const newConversation = await createConversationAction({
          title,
          model: currentModel,
          settings,
        } as any);
        // 立刻让本地会话包含用户消息，避免短暂丢失
        const withFirstMessage = { ...newConversation, messages: [userMessage] } as any;
        setCurrentConversation(withFirstMessage);
        addConversation(withFirstMessage);
        conversationId = newConversation.id;
      } else {
        // 现有会话，直接追加本地消息
        addMessage(userMessage);
      }

      // 按模型选择 API 路由
      const apiEndpoint = currentModel === 'gemini-2.5-flash-image-preview'
        ? '/api/gemini-2.5-flash-image-preview'
        : '/api/gpt-5';

      // Responses API 入参：文本或图文
      // - 纯文本：input 直接用 string
      // - 图文：input 为 [{ role:'user', content: [ {type:'input_text'}, {type:'input_image'}... ] }]
      const toImageItem = (img: string) => {
        // Responses API 不接受 image_data；统一用 image_url（可为 data URL 或远程 URL）
        return { type: 'input_image', image_url: img } as any;
      };

      let input: string | any[];
      if (images && images.length > 0) {
        input = [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: content },
              ...images.map(toImageItem),
            ],
          },
        ];
      } else {
        input = content;
      }

      const requestBody: any = {
        conversationId,
        input,
        model: currentModel,
        settings,
        stream: true,
        // 仅当模型支持联网搜索时才传递
        ...(MODELS[currentModel]?.supportsSearch ? { webSearch: webSearchEnabled } : {}),
      };

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
        let assistantImages: string[] = [];
        let reasoning = '';
        let chunkCount = 0;
        let routedModel: string | null = null;
        let assistantAdded = false;
        let searchUsed = false;
        let latestSources: any[] = [];

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
                  case 'images':
                    if (Array.isArray(data.images)) {
                      assistantImages = data.images.filter((u: any) => typeof u === 'string' && u);
                    }
                    break;
                  case 'search':
                    searchUsed = !!(data.used || data.searchUsed);
                    break;
                  case 'search_sources':
                    if (Array.isArray(data.sources)) {
                      latestSources = data.sources;
                    }
                    break;

                  case 'reasoning':
                    reasoning += data.content;
                    setReasoningContent(reasoning);
                    break;

                  // 无 routing 事件

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
                      images: assistantImages && assistantImages.length > 0 ? assistantImages : undefined,
                      metadata: {
                        reasoning: reasoning || undefined,
                        verbosity: settings.text?.verbosity,
                        searchUsed: searchUsed || undefined,
                        sources: latestSources && latestSources.length > 0 ? latestSources : undefined,
                      },
                    };
                    addMessage(assistantMessage);
                    assistantAdded = true;
                    // 已本地追加消息，避免再拉取覆盖
                    // 归一化路由日志（done 时若未提前收到 routing 事件，则以当前模型作为兜底）
                    // 运行日志已在服务端记录
                    setStreamingContent('');
                    setReasoningContent('');
                    break;

                  case 'error':
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
        // 循环结束：如果没有收到 done 事件，但流已结束且有内容，则补写一条
        if (!assistantAdded && assistantContent) {
          addMessage({
            id: generateId(),
            role: 'assistant',
            content: assistantContent,
            timestamp: new Date(),
            model: routedModel || currentModel,
            metadata: reasoning ? { reasoning, verbosity: settings.text?.verbosity } : undefined,
          } as any);
        }
        // 收尾：清理临时状态与日志观察器
        setStreamingContent('');
        setReasoningContent('');
      } else {
        // 处理非流式响应
        const data = await response.json();

        if (data.message) {
          addMessage({
            ...data.message,
            id: generateId(),
            timestamp: new Date(),
          });
          // 顶部来源条已移除，不再维护全局来源列表
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
      {/* 顶栏：始终显示模型切换器 */}
      <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 py-3">
          {/* 左侧：模型切换（ghost 变体） */}
          <div className="flex items-center gap-3">
            <ModelSelector variant="ghost" />
          </div>

          {/* 中间：标题占位 */}
          <div className="flex-1 flex items-center justify-center">
            {currentConversation?.title && (
              <div className="text-xs text-muted-foreground">{currentConversation.title}</div>
            )}
          </div>

        </div>
      </div>

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

          {/* 顶部来源条已按需求移除 */}

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

      {/* 用户管理面板 */}
      <UserPanel />
      {/* 登录弹窗 */}
      <LoginModal />
      {/* 顶部来源条及其弹窗已移除 */}
    </div>
  );
}
