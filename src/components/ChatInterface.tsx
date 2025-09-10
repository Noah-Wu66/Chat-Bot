'use client';

import { useState, useCallback, useRef } from 'react';
import { useChatStore } from '@/store/chatStore';
import { MODELS } from '@/lib/types';
import { generateId, generateTitleFromMessage } from '@/utils/helpers';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
// 删除顶部来源条相关导入
// 顶部不再显示模型切换按钮
import UserPanel from './UserPanel';
import LoginModal from './LoginModal';
import { playCompletionChime } from '@/utils/helpers';

export default function ChatInterface() {
  const {
    currentConversation,
    setCurrentConversation,
    addConversation,
    addMessage,
    updateConversation,
    currentModel,
    settings,
    isStreaming,
    setStreaming,
    setError,
  } = useChatStore();

  const [streamingContent, setStreamingContent] = useState('');
  const [reasoningContent, setReasoningContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [editingImages, setEditingImages] = useState<string[] | undefined>(undefined);
  // 已移除顶部来源条，不再在此维护来源弹窗状态
  const { webSearchEnabled } = useChatStore();


  // 发送消息（支持编辑模式：提交前会截断后续消息）
  const handleSendMessage = useCallback(async (
    content: string,
    images?: string[],
    media?: { audios?: string[]; videos?: string[] }
  ) => {
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

      // 编辑场景：在发送前，若存在 editingMessageId，则向后端请求截断，并本地乐观截断
      let conversationId = currentConversation?.id;
      if (editingMessageId && conversationId) {
        try {
          await fetch('/api/conversations', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id: conversationId, op: 'truncate_before', messageId: editingMessageId }),
          });
        } catch {}
        // 本地截断
        setCurrentConversation({
          ...currentConversation!,
          messages: currentConversation!.messages.slice(0, currentConversation!.messages.findIndex((m: any) => m.id === editingMessageId)),
          updatedAt: new Date(),
        } as any);
        setEditingMessageId(null);
        setEditingValue('');
        setEditingImages(undefined);
      }

      // 如果没有当前对话，或当前对话模型与所选模型不一致，则创建新对话，并确保本地立即包含首条用户消息
      if (!conversationId || currentConversation?.model !== currentModel) {
        const title = generateTitleFromMessage(content);
        const response = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            model: currentModel,
            settings,
          }),
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error('创建对话失败');
        }
        const newConversation = await response.json();
        // 立刻让本地会话包含用户消息，避免短暂丢失
        const withFirstMessage = { ...newConversation, messages: [userMessage] } as any;
        setCurrentConversation(withFirstMessage);
        addConversation(withFirstMessage);
        conversationId = newConversation.id;
      } else {
        // 现有会话：如是该会话的第一条用户消息，则按规则重命名标题
        if (currentConversation && (currentConversation.messages?.length || 0) === 0) {
          const newTitle = generateTitleFromMessage(content);
          if (newTitle && newTitle !== currentConversation.title) {
            try {
              await fetch('/api/conversations', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ id: currentConversation.id, title: newTitle }),
              });
              updateConversation(currentConversation.id, { title: newTitle });
              setCurrentConversation({ ...currentConversation, title: newTitle } as any);
            } catch {}
          }
        }
        // 现有会话，直接追加本地消息
        addMessage(userMessage);
      }

      // 按模型选择 API 路由（Gemini 统一到 /api/gemini）
      let apiEndpoint = '/api/gpt-5';
      if (currentModel === 'gemini-2.5-flash-image-preview') {
        apiEndpoint = '/api/gemini-2.5-flash-image-preview';
      } else if (currentModel === 'veo3-fast') {
        apiEndpoint = '/api/veo3-fast';
      } else if (currentModel === 'gemini-2.5-pro') {
        apiEndpoint = '/api/gemini';
      }

      // Responses API 入参：文本或图文
      // - 纯文本：input 直接用 string
      // - 图文：input 为 [{ role:'user', content: [ {type:'input_text'}, {type:'input_image'}... ] }]
      const toImageItem = (img: string) => {
        // Responses API 不接受 image_data；统一用 image_url（可为 data URL 或远程 URL）
        return { type: 'input_image', image_url: img } as any;
      };
      const parseDataUrl = (dataUrl: string): { mime: string; data: string; format?: string } | null => {
        try {
          if (typeof dataUrl !== 'string') return null;
          const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
          if (!m) return { mime: 'application/octet-stream', data: dataUrl } as any;
          const mime = m[1];
          const data = m[2];
          let format: string | undefined;
          if (mime.startsWith('audio/')) {
            const sub = mime.split('/')[1];
            format = sub === 'mpeg' ? 'mp3' : (sub || 'wav');
          }
          return { mime, data, format };
        } catch { return null; }
      };
      const toAudioItem = (b64OrDataUrl: string) => {
        const parsed = parseDataUrl(b64OrDataUrl);
        if (parsed && parsed.mime.startsWith('data:')) {
          // already handled
        }
        if (parsed) {
          return { type: 'input_audio', inline_data: { data: parsed.data, mime_type: parsed.mime }, audio: parsed.format ? { data: parsed.data, format: parsed.format } : undefined } as any;
        }
        // 退化：直接当作 data url
        return { type: 'input_audio', inline_data: { data: b64OrDataUrl, mime_type: 'audio/m4a' } } as any;
      };
      const toVideoItem = (b64OrDataUrl: string) => {
        const parsed = parseDataUrl(b64OrDataUrl);
        if (parsed) {
          return { type: 'input_video', inline_data: { data: parsed.data, mime_type: parsed.mime } } as any;
        }
        return { type: 'input_video', inline_data: { data: b64OrDataUrl, mime_type: 'video/mp4' } } as any;
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
      } else if (media && (Array.isArray(media.audios) ? media.audios.length > 0 : false)) {
        input = [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: content },
              ...((media.audios || []).map(toAudioItem)),
            ],
          },
        ];
      } else if (media && (Array.isArray(media.videos) ? media.videos.length > 0 : false)) {
        input = [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: content },
              ...((media.videos || []).map(toVideoItem)),
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

      try { console.log('[Chat][diag] origin', window.location.origin, 'path', window.location.pathname); } catch {}
      let response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        credentials: 'include',
        signal: controller.signal,
      });

      // 统一接口后不再需要 /api/gemini-2.5-pro 或下划线回退

      if (!response.ok) {
        const status = response.status;
        const statusText = response.statusText;
        let bodyText = '';
        try { bodyText = await response.text(); } catch {}
        try {
          console.error('[Chat][diag] HTTP error', { status, statusText, url: apiEndpoint, xMatchedPath: response.headers.get('x-nextjs-matched-path'), xVercelId: response.headers.get('x-vercel-id'), contentType: response.headers.get('content-type'), bodyPreview: bodyText?.slice?.(0, 500) });
        } catch {}
        try {
          const errorData = JSON.parse(bodyText);
          throw new Error(errorData.error || `请求失败 (${status})`);
        } catch {
          throw new Error(bodyText || `请求失败 (${status})`);
        }
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
        let assistantVideos: string[] = [];
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
                case 'video':
                  if (data.url && typeof data.url === 'string') {
                    assistantVideos = [data.url];
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
                    videos: assistantVideos && assistantVideos.length > 0 ? assistantVideos : undefined,
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
                  try { if (settings?.sound?.onComplete !== false) { playCompletionChime(); } } catch {}
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
          try { if (settings?.sound?.onComplete !== false) { playCompletionChime(); } } catch {}
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
          try { if (settings?.sound?.onComplete !== false) { playCompletionChime(); } } catch {}
        } else {
          // 兜底：如果服务端直接返回 video 字段
          const videoUrl = data?.data?.video?.url || data?.video?.url || data?.output?.video?.url;
          if (videoUrl) {
            addMessage({
              id: generateId(),
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              model: currentModel,
              videos: [videoUrl],
            } as any);
            try { if (settings?.sound?.onComplete !== false) { playCompletionChime(); } } catch {}
          }
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
    editingMessageId,
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
      {/* 顶栏：移除模型按钮，仅保留用户面板与标题区域 */}
      <div className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* 移动端顶栏（不含模型切换）*/}
        <div className="flex items-center justify-between px-3 py-2 sm:hidden">
          <div className="flex items-center gap-2 ml-10" />
        </div>

        {/* 桌面端顶栏（不含模型切换）*/}
        <div className="hidden sm:flex items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 md:gap-3" />
          <div className="flex-1 flex items-center justify-center px-2">
            {currentConversation?.title && (
              <div className="text-xs text-muted-foreground truncate max-w-[200px] md:max-w-none">{currentConversation.title}</div>
            )}
          </div>
          <div className="flex items-center" />
        </div>
      </div>

      {/* 主体区域 */}
      {(!currentConversation || currentConversation.messages.length === 0) ? (
        // 首页空状态（仿 ChatGPT）
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex h-full max-w-3xl flex-col items-center justify-center gap-4 sm:gap-6 md:gap-8 px-3 sm:px-4 md:px-6 text-center">
            <div>
              <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight">您在忙什么？</h1>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground px-2 sm:px-4">输入问题或指令，开始与智能助手对话</p>
            </div>
            <div className="w-full max-w-2xl px-2 sm:px-0">
              <MessageInput
                onSendMessage={handleSendMessage}
                disabled={isStreaming}
                variant="center"
                autoFocus
                onStop={handleStopStreaming}
              />
            </div>
            <div className="text-xs text-muted-foreground px-2 sm:px-4">AI助手可能会出错，请核查重要信息。</div>
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
            onEditMessage={(msg) => {
              setEditingMessageId(msg.id);
              setEditingValue(msg.content || '');
              setEditingImages(Array.isArray(msg.images) ? msg.images : undefined);
            }}
            onRegenerateAssistant={async (assistantMsg) => {
              try {
                if (!currentConversation) return;
                setError(null);
                setStreaming(true);
                setStreamingContent('');
                setReasoningContent('');

                const controller = new AbortController();
                abortRef.current = controller;

                // 找到该助手消息之前最近一条用户消息，作为重答的起点
                const msgs = currentConversation.messages;
                const aIndex = msgs.findIndex((m: any) => m.id === assistantMsg.id);
                if (aIndex <= 0) throw new Error('未找到可重答的用户消息');
                let userIndex = -1;
                for (let i = aIndex - 1; i >= 0; i--) {
                  if ((msgs[i] as any).role === 'user') { userIndex = i; break; }
                }
                if (userIndex === -1) throw new Error('未找到可重答的用户消息');
                const userMsg = msgs[userIndex];

                // 后端：将会话截断到该用户消息之前（不含该用户消息），然后 regenerate 模式直接用这条用户消息作为 input 触发模型重答
                await fetch('/api/conversations', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ id: currentConversation.id, op: 'truncate_before', messageId: userMsg.id })
                });

                // 本地乐观截断：仅保留 userMsg 之前的所有消息
                const kept = msgs.slice(0, userIndex);
                setCurrentConversation({ ...currentConversation, messages: kept } as any);

                // 重新发送该用户消息（regenerate 模式：不重复写入用户消息，只让模型重答）
                const apiEndpoint = currentModel === 'gemini-2.5-flash-image-preview'
                  ? '/api/gemini-2.5-flash-image-preview'
                  : (currentModel === 'veo3-fast'
                    ? '/api/veo3-fast'
                    : (currentModel === 'gemini-2.5-pro' ? '/api/gemini' : '/api/gpt-5'));

                const toImageItem = (img: string) => ({ type: 'input_image', image_url: img } as any);
                let input: string | any[];
                if (Array.isArray(userMsg.images) && userMsg.images.length > 0) {
                  input = [ { role: 'user', content: [ { type: 'input_text', text: userMsg.content }, ...(userMsg.images || []).map(toImageItem) ] } ];
                } else {
                  input = userMsg.content;
                }

                try { console.log('[Chat][diag][regenerate] origin', window.location.origin, 'path', window.location.pathname); } catch {}
                let response = await fetch(apiEndpoint, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  signal: controller.signal,
                  body: JSON.stringify({
                    conversationId: currentConversation.id,
                    input,
                    model: currentModel,
                    settings,
                    stream: true,
                    regenerate: true,
                    ...(MODELS[currentModel]?.supportsSearch ? { webSearch: webSearchEnabled } : {}),
                  })
                });

                // 统一接口后不再需要 /api/gemini-2_5-pro 回退

                if (!response.ok) {
                  const status = response.status;
                  const statusText = response.statusText;
                  let bodyText = '';
                  try { bodyText = await response.text(); } catch {}
                  try {
                    console.error('[Chat][diag][regenerate] HTTP error', { status, statusText, url: apiEndpoint, xMatchedPath: response.headers.get('x-nextjs-matched-path'), xVercelId: response.headers.get('x-vercel-id'), contentType: response.headers.get('content-type'), bodyPreview: bodyText?.slice?.(0, 500) });
                  } catch {}
                  try {
                    const err = JSON.parse(bodyText);
                    throw new Error(err?.error || `请求失败 (${status})`);
                  } catch {
                    throw new Error(bodyText || `请求失败 (${status})`);
                  }
                }

                const contentType = response.headers.get('Content-Type') || '';
                const canStream = contentType.includes('text/event-stream');
                if (!canStream) throw new Error('不支持的响应');

                const reader = response.body?.getReader();
                const decoder = new TextDecoder();
                if (!reader) throw new Error('无法读取响应流');

                let assistantContent = '';
                let assistantImages: string[] = [];
                let reasoning = '';
                let assistantAdded = false;
                let searchUsed = false;
                let latestSources: any[] = [];
                let sseBuffer = '';
                let assistantVideos: string[] = [];
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  const chunk = decoder.decode(value, { stream: true });
                  sseBuffer += chunk;
                  while (true) {
                    const sepIndex = sseBuffer.indexOf('\n\n');
                    if (sepIndex === -1) break;
                    const block = sseBuffer.slice(0, sepIndex);
                    sseBuffer = sseBuffer.slice(sepIndex + 2);
                    try {
                      const dataLines = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6));
                      if (dataLines.length === 0) continue;
                      const data = JSON.parse(dataLines.join('\n'));
                      switch (data.type) {
                        case 'content':
                          assistantContent += data.content;
                          setStreamingContent(assistantContent);
                          break;
                        case 'images':
                          if (Array.isArray(data.images)) assistantImages = data.images.filter((u: any) => typeof u === 'string' && u);
                          break;
                        case 'video':
                          if (data.url && typeof data.url === 'string') assistantVideos = [data.url];
                          break;
                        case 'reasoning':
                          reasoning += data.content;
                          setReasoningContent(reasoning);
                          break;
                        case 'search':
                          searchUsed = !!(data.used || data.searchUsed);
                          break;
                        case 'search_sources':
                          if (Array.isArray(data.sources)) latestSources = data.sources;
                          break;
                        case 'done': {
                          const assistantMessage = {
                            id: generateId(),
                            role: 'assistant' as const,
                            content: assistantContent,
                            timestamp: new Date(),
                            model: currentModel,
                            images: assistantImages && assistantImages.length > 0 ? assistantImages : undefined,
                            videos: assistantVideos && assistantVideos.length > 0 ? assistantVideos : undefined,
                            metadata: {
                              reasoning: reasoning || undefined,
                              verbosity: settings.text?.verbosity,
                              searchUsed: searchUsed || undefined,
                              sources: latestSources && latestSources.length > 0 ? latestSources : undefined,
                            },
                          };
                          addMessage(assistantMessage);
                          assistantAdded = true;
                          setStreamingContent('');
                          setReasoningContent('');
                          try { if (settings?.sound?.onComplete !== false) { playCompletionChime(); } } catch {}
                          break;
                        }
                        case 'error':
                          throw new Error(data.error);
                        default:
                          break;
                      }
                    } catch {}
                  }
                }
                if (!assistantAdded && assistantContent && !controller.signal.aborted) {
                  addMessage({ id: generateId(), role: 'assistant', content: assistantContent, timestamp: new Date(), model: currentModel } as any);
                  try { if (settings?.sound?.onComplete !== false) { playCompletionChime(); } } catch {}
                }
              } catch (e: any) {
                setError(e?.message || '重答失败');
              } finally {
                setStreaming(false);
                setStreamingContent('');
                setReasoningContent('');
                abortRef.current = null;
              }
            }}
          />

          {/* 顶部来源条已按需求移除 */}

          {/* 输入区域 */}
          <div className="border-t border-border bg-background p-2 sm:p-4 pb-safe-area-inset-bottom">
            <div className="mx-auto max-w-4xl">
              <MessageInput
                onSendMessage={handleSendMessage}
                disabled={isStreaming}
                onStop={handleStopStreaming}
                initialValue={editingValue}
                initialImages={editingImages}
                isEditing={!!editingMessageId}
                onCancelEdit={() => { setEditingMessageId(null); setEditingValue(''); setEditingImages(undefined); }}
              />
            </div>
          </div>
        </>
      )}

      {/* 登录弹窗 */}
      <LoginModal />
      {/* 用户管理弹窗（居中模态） */}
      <UserPanel />
      {/* 顶部来源条及其弹窗已移除 */}
    </div>
  );
}
