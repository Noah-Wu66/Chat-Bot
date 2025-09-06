'use client';

import { useState, useCallback, useRef } from 'react';
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
  const abortRef = useRef<AbortController | null>(null);
  // 已移除顶部来源条，不再在此维护来源弹窗状态
  const { webSearchEnabled } = useChatStore();


  // 发送消息
  const handleSendMessage = useCallback(async (content: string, images?: string[]) => {
    try {
      setError(null);
      setStreaming(true);
      setStreamingContent('');
      setReasoningContent('');

      // 建立可中断控制器
      const controller = new AbortController();
      abortRef.current = controller;

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

      // 调试：请求概览（不含敏感信息）
      try {
        const inputType = Array.isArray(input) ? 'array' : 'string';
        const imgCount = Array.isArray(images) ? images.length : 0;
        console.log('[Chat] sending request', {
          endpoint: apiEndpoint,
          model: currentModel,
          inputType,
          hasImages: imgCount > 0,
          imagesCount: imgCount,
          stream: true,
          webSearch: MODELS[currentModel]?.supportsSearch ? webSearchEnabled : undefined,
        });
      } catch {}

      let response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        credentials: 'include',
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '请求失败');
      }

      const contentType = response.headers.get('Content-Type') || '';
      const canStream = contentType.includes('text/event-stream');

      // 调试：响应头
      try {
        console.log('[Chat] response headers', {
          contentType,
          xModel: response.headers.get('X-Model'),
          xRequestId: response.headers.get('X-Request-Id'),
        });
      } catch {}

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

        let sseBuffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          chunkCount++;
          const chunk = decoder.decode(value, { stream: true });
          sseBuffer += chunk;

          // 使用空行分隔的事件块解析（兼容大数据量，例如 base64 图片）
          while (true) {
            const sepIndex = sseBuffer.indexOf('\n\n');
            if (sepIndex === -1) break;
            const block = sseBuffer.slice(0, sepIndex);
            sseBuffer = sseBuffer.slice(sepIndex + 2);

            try {
              const dataLines = block
                .split('\n')
                .filter((l) => l.startsWith('data: '))
                .map((l) => l.slice(6));
              if (dataLines.length === 0) continue;
              const payload = dataLines.join('\n');
              const data = JSON.parse(payload);

              switch (data.type) {
                case 'content':
                  assistantContent += data.content;
                  setStreamingContent(assistantContent);
                  if (data.content) {
                    console.debug('[SSE] content delta', { length: String(data.content).length });
                  }
                  break;
                case 'images':
                  if (Array.isArray(data.images)) {
                    assistantImages = data.images.filter((u: any) => typeof u === 'string' && u);
                  }
                  console.log('[SSE] images event received', {
                    count: Array.isArray(data.images) ? data.images.length : 0,
                    sample: Array.isArray(data.images) && data.images.length > 0 ? data.images[0]?.slice?.(0, 64) : undefined,
                  });
                  break;
                case 'search':
                  searchUsed = !!(data.used || data.searchUsed);
                  break;
                case 'search_sources':
                  if (Array.isArray(data.sources)) {
                    latestSources = data.sources;
                  }
                  break;
                case 'debug':
                  console.log('[SSE][debug]', data);
                  break;
                case 'reasoning':
                  reasoning += data.content;
                  setReasoningContent(reasoning);
                  break;
                case 'start':
                case 'tool_call_start':
                  break;
                case 'function_result':
                case 'tool_result':
                  assistantContent += `\n\n**工具调用结果 (${data.tool || data.function}):**\n${data.result}`;
                  setStreamingContent(assistantContent);
                  break;
                case 'done':
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
                  console.log('[SSE] done: assistant message appended', {
                    textLength: assistantContent.length,
                    images: assistantImages?.length || 0,
                  });
                  assistantAdded = true;
                  setStreamingContent('');
                  setReasoningContent('');
                  break;
                case 'error':
                  throw new Error(data.error);
                default:
                  // ignore
              }
            } catch (parseError) {
              console.debug('[SSE] parse error', parseError);
            }
          }
        }
        // 循环结束：如果没有收到 done 事件，但流已结束且有内容，则补写一条
        if (!assistantAdded && assistantContent && !controller.signal.aborted) {
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
          console.log('[HTTP] non-stream message', {
            hasImages: Array.isArray(data?.message?.images) && data.message.images.length > 0,
            imagesCount: Array.isArray(data?.message?.images) ? data.message.images.length : 0,
          });
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
    } catch (error: any) {
      const aborted = !!(error && (error.name === 'AbortError' || String(error?.message || '').toLowerCase().includes('abort')));
      if (aborted) {
        // 用户主动停止：静默处理
      } else {
      console.error('[Chat] request failed', error);
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
      }
    } finally {
      setStreaming(false);
      setStreamingContent('');
      setReasoningContent('');
      // 清理控制器
      abortRef.current = null;
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

  const handleStopStreaming = useCallback(() => {
    try {
      const controller = abortRef.current;
      if (controller && !controller.signal.aborted) {
        controller.abort();
      }
    } catch {}
    setStreaming(false);
    setStreamingContent('');
    setReasoningContent('');
  }, [setStreaming]);

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏：始终显示模型切换器 */}
      <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center justify-between px-4 py-3 md:px-6">
          {/* 左侧：模型切换（ghost 变体） */}
          <div className="flex items-center gap-2 md:gap-3">
            <ModelSelector variant="ghost" />
          </div>

          {/* 中间：标题占位 - 移动端隐藏过长标题 */}
          <div className="flex-1 flex items-center justify-center px-2">
            {currentConversation?.title && (
              <div className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px] md:max-w-none">{currentConversation.title}</div>
            )}
          </div>

          {/* 右侧：用户面板按钮 - 移动端 */}
          <div className="flex items-center">
            <UserPanel />
          </div>
        </div>
      </div>

      {/* 主体区域 */}
      {(!currentConversation || currentConversation.messages.length === 0) ? (
        // 首页空状态（仿 ChatGPT）
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-6 md:gap-8 px-4 sm:px-6 text-center">
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">您在忙什么？</h1>
              <p className="mt-2 text-sm text-muted-foreground px-4">输入问题或指令，开始与智能助手对话</p>
            </div>
            <div className="w-full max-w-2xl">
              <MessageInput
                onSendMessage={handleSendMessage}
                disabled={isStreaming}
                variant="center"
                autoFocus
                onStop={handleStopStreaming}
              />
            </div>
            <div className="text-xs text-muted-foreground px-4">AI助手可能会出错，请核查重要信息。</div>
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
          <div className="border-t border-border bg-background p-3 sm:p-4 pb-safe-area-inset-bottom">
            <div className="mx-auto max-w-4xl">
              <MessageInput
                onSendMessage={handleSendMessage}
                disabled={isStreaming}
                onStop={handleStopStreaming}
              />
            </div>
          </div>
        </>
      )}

      {/* 登录弹窗 */}
      <LoginModal />
      {/* 顶部来源条及其弹窗已移除 */}
    </div>
  );
}
