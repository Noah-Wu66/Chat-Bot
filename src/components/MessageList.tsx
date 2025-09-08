'use client';

import { useEffect, useRef, useState } from 'react';
import { User, Bot, Copy, Brain, Link as LinkIcon, ExternalLink, Pencil, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '@/lib/types';
import { useChatStore } from '@/store/chatStore';
import { formatTime, copyToClipboard, cn } from '@/utils/helpers';
import LoadingSpinner from './LoadingSpinner';
import SearchSourcesModal from './SearchSourcesModal';
import ImagePreviewModal from './ImagePreviewModal';
import VideoPreviewModal from './VideoPreviewModal';

interface MessageListProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
  reasoningContent?: string;
  onEditMessage?: (message: Message) => void;
  onRegenerateAssistant?: (assistantMessage: Message) => void;
}

export default function MessageList({
  messages,
  isStreaming,
  streamingContent,
  reasoningContent,
  onEditMessage,
  onRegenerateAssistant,
}: MessageListProps) {
  function VideoAutoPreview({ src, onClick }: { src: string; onClick: () => void }) {
    const videoRef = useRef<HTMLVideoElement>(null);
    useEffect(() => {
      const v = videoRef.current;
      if (!v) return;
      const onLoadedData = () => {
        try {
          // 确保展示第一帧
          v.pause();
          if (v.currentTime > 0) return;
          v.currentTime = 0;
        } catch {}
      };
      v.addEventListener('loadeddata', onLoadedData);
      try {
        // 预加载并尝试静音自动播放以解码首帧，然后立刻暂停
        v.preload = 'auto';
        v.muted = true;
        v.playsInline = true;
        v.load();
        const p = v.play();
        if (p && typeof (p as any).then === 'function') {
          (p as Promise<void>).then(() => {
            try { v.pause(); } catch {}
          }).catch(() => {
            // 自动播放可能被阻止，忽略即可（已设置 preload）
          });
        }
      } catch {}
      return () => {
        try { v.removeEventListener('loadeddata', onLoadedData); } catch {}
      };
    }, [src]);
    return (
      <button
        className="group relative overflow-hidden rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary touch-manipulation"
        onClick={onClick}
        title="点击预览大视频"
      >
        <video
          ref={videoRef}
          src={src}
          className="h-32 sm:h-48 max-h-48 sm:max-h-72 w-auto max-w-full object-contain"
          muted
          playsInline
          controls={false}
          preload="auto"
        />
        <div className="pointer-events-none absolute inset-0 flex items-end justify-end p-1">
          <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">点击放大</span>
        </div>
      </button>
    );
  }
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [sourcesModalOpen, setSourcesModalOpen] = useState(false);
  const [sourcesForModal, setSourcesForModal] = useState<any[]>([]);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewVideoSrc, setPreviewVideoSrc] = useState<string | null>(null);
  const { currentModel } = useChatStore();
  const isGeneratingModel = currentModel === 'veo3-fast' || currentModel === 'gemini-2.5-flash-image-preview';

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // 调试：记录最新一条助手消息的文本与图片数量
    try {
      const last = messages[messages.length - 1];
      if (last && last.role === 'assistant') {
        console.log('[UI] assistant message arrived', {
          textLength: (last.content || '').length,
          images: Array.isArray(last.images) ? last.images.length : 0,
          sample: Array.isArray(last.images) && last.images.length > 0 ? last.images[0]?.slice?.(0, 64) : undefined,
        });
      }
    } catch {}
  }, [messages, streamingContent]);

  // 复制消息内容
  const handleCopy = async (content: string) => {
    const success = await copyToClipboard(content);
    if (success) {
      // 这里可以添加成功提示
    }
  };

  // 渲染代码块
  const renderCode = ({ node, inline, className, children, ...props }: any) => {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';

    if (!inline && language) {
      return (
        <div className="relative">
          <div className="flex items-center justify-between rounded-t-md bg-muted px-4 py-2">
            <span className="text-sm text-muted-foreground">{language}</span>
            <button
              onClick={() => handleCopy(String(children).replace(/\n$/, ''))}
              className="text-muted-foreground hover:text-foreground"
              title="复制代码"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <SyntaxHighlighter
            style={oneDark}
            language={language}
            PreTag="div"
            className="!mt-0 !rounded-t-none"
            {...props}
          >
            {String(children).replace(/\n$/, '')}
          </SyntaxHighlighter>
        </div>
      );
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  };

  // 渲染消息
  const renderMessage = (message: Message, index: number) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';

    return (
      <div
        key={message.id}
        className={cn(
          "chat-message flex gap-2 sm:gap-3 p-3 sm:p-4",
          isUser && "flex-row-reverse bg-muted/30",
          isSystem && "bg-accent/50"
        )}
      >
        {/* 头像 */}
        <div className={cn(
          "flex h-6 w-6 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
        )}>
          {isUser ? <User className="h-3 w-3 sm:h-4 sm:w-4" /> : <Bot className="h-3 w-3 sm:h-4 sm:w-4" />}
        </div>

        {/* 消息内容 */}
        <div className="flex-1 space-y-2">
          {/* 消息头部 */}
          <div className={cn(
            "flex items-center gap-1 sm:gap-2 text-xs sm:text-sm text-muted-foreground flex-wrap",
            isUser && "flex-row-reverse"
          )}>
            <span className="font-medium">
              {isUser ? '你' : isSystem ? '系统' : 'AI助手'}
            </span>
            {message.model && (
              <span className="rounded bg-muted px-1 sm:px-1.5 py-0.5 text-[10px] sm:text-xs hidden sm:inline">
                {message.model}
              </span>
            )}
            <span>{formatTime(message.timestamp)}</span>
          </div>

          {/* 图片 */}
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {message.images.map((image, imgIndex) => (
                <button
                  key={imgIndex}
                  className="group relative overflow-hidden rounded-lg border focus:outline-none focus:ring-2 focus:ring-primary touch-manipulation"
                  onClick={() => {
                    setPreviewSrc(image);
                  }}
                  title="点击预览大图"
                >
                  <img
                    src={image}
                    alt={`消息图片 ${imgIndex + 1}`}
                    className="h-32 sm:h-48 max-h-48 sm:max-h-72 w-auto max-w-full object-contain"
                  />
                  <div className="pointer-events-none absolute inset-0 hidden items-end justify-end gap-1 p-1 group-hover:flex" />
                </button>
              ))}
            </div>
          )}

          {/* 视频（缩略预览 + 点击弹窗）*/}
          {message.videos && message.videos.length > 0 && (
            <div className="flex flex-wrap gap-2 sm:gap-3">
              {message.videos.map((video, vIndex) => (
                <VideoAutoPreview key={vIndex} src={video} onClick={() => setPreviewVideoSrc(video)} />
              ))}
            </div>
          )}

          {/* 推理过程 */}
          {message.metadata?.reasoning && (
            <div className="reasoning-panel">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                <span className="font-medium text-sm">推理过程</span>
              </div>
              <div className="whitespace-pre-wrap text-xs sm:text-sm">
                {message.metadata.reasoning}
              </div>
            </div>
          )}

          {/* 函数调用 */}
          {message.functionCall && (
            <div className="function-call">
              <div className="font-medium text-sm">函数调用: {message.functionCall.name}</div>
              <pre className="mt-1 text-xs sm:text-sm overflow-x-auto">
                {message.functionCall.arguments}
              </pre>
              {message.functionResult && (
                <div className="function-result">
                  <div className="font-medium text-sm">执行结果:</div>
                  <div className="mt-1 text-xs sm:text-sm">{message.functionResult.result}</div>
                </div>
              )}
            </div>
          )}

          {/* 消息正文 */}
          <div className={cn(
            "message-content",
            isUser && "text-right"
          )}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: renderCode,
                pre: ({ children }) => <div>{children}</div>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* 元数据（去除详细程度显示） */}
          {message.metadata && (
            <div className="flex flex-wrap gap-1 sm:gap-2 text-[10px] sm:text-xs text-muted-foreground">
              {message.metadata.tokensUsed && (
                <span className="hidden sm:inline">Token: {message.metadata.tokensUsed}</span>
              )}
              {message.metadata.searchUsed && (
                <span className="text-green-600">使用了网络搜索</span>
              )}
            </div>
          )}

          {/* 用户消息操作：编辑 */}
          {isUser && (
            <div className={cn("mt-1 flex items-center gap-1 sm:gap-2 text-muted-foreground text-[10px] flex-wrap", isUser && "justify-end")}> 
              <button
                onClick={() => onEditMessage && onEditMessage(message)}
                className="rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-accent-foreground touch-manipulation"
                title="编辑并重新生成"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* 助手消息操作：重新回答 + 复制 + 数据来源（圆角长方形容器 + 查看来源）*/}
          {!isUser && (
            <div className="mt-1 flex items-center gap-1 sm:gap-2 text-muted-foreground text-[10px] flex-wrap">
              <button
                onClick={() => onRegenerateAssistant && onRegenerateAssistant(message)}
                disabled={!!isStreaming}
                className="rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-accent-foreground touch-manipulation disabled:pointer-events-none disabled:opacity-50"
                title="重新回答"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleCopy(message.content)}
                className="rounded-full border px-1.5 py-0.5 text-[10px] hover:bg-accent hover:text-accent-foreground touch-manipulation"
                title="复制"
              >
                <Copy className="h-3 w-3" />
              </button>

              {Array.isArray(message?.metadata?.sources) && message.metadata!.sources!.length > 0 && (
                <div className="ml-1 flex items-center gap-1 sm:gap-2 flex-wrap">
                  <div className="inline-flex items-center gap-1 sm:gap-2 rounded-md border bg-card/60 px-1.5 sm:px-2 py-1">
                    <div className="flex items-center gap-1 sm:gap-1.5">
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-muted-foreground"><LinkIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3" /><span className="hidden sm:inline">来源</span></span>
                      <div className="flex items-center gap-1">
                        {message.metadata!.sources!.slice(0, 3).map((src: any, i: number) => {
                          const title = src?.title || src?.domain || `来源${i + 1}`;
                          const domain = src?.domain || '';
                          const favicon = src?.favicon || '';
                          return (
                            <span
                              key={i}
                              className="inline-flex h-4 w-4 sm:h-5 sm:w-5 items-center justify-center overflow-hidden rounded-full bg-muted ring-1 ring-border"
                              title={title}
                            >
                              {favicon ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={favicon} alt={domain || title} className="h-4 w-4 sm:h-5 sm:w-5" />
                              ) : (
                                <LinkIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="ml-1 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] hover:bg-accent hover:text-accent-foreground touch-manipulation"
                      onClick={() => {
                        setSourcesForModal(message.metadata!.sources!);
                        setSourcesModalOpen(true);
                      }}
                    >
                      <span className="hidden sm:inline">查看来源</span>
                      <span className="sm:hidden">查看</span>
                      <ExternalLink className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      {messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-center">
          <div className="space-y-4">
            <Bot className="mx-auto h-12 w-12 text-muted-foreground" />
            <div>
              <h3 className="text-lg font-medium">开始新对话</h3>
              <p className="text-muted-foreground">在下方输入框中输入内容即可开始</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="group">
          {messages.map(renderMessage)}

          {sourcesModalOpen && (
            <SearchSourcesModal
              sources={sourcesForModal}
              onClose={() => setSourcesModalOpen(false)}
            />
          )}

          {previewSrc && (
            <ImagePreviewModal src={previewSrc} onClose={() => setPreviewSrc(null)} />
          )}

          {previewVideoSrc && (
            <VideoPreviewModal src={previewVideoSrc} onClose={() => setPreviewVideoSrc(null)} />
          )}

          {/* 等待模型响应时的占位加载 */}
          {isStreaming && !streamingContent && (
            <div className="chat-message flex gap-2 sm:gap-3 p-3 sm:p-4">
              <div className="flex h-6 w-6 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Bot className="h-3 w-3 sm:h-4 sm:w-4" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <span className="font-medium">AI助手</span>
                  <span className="loading-dots">{`AI正在${isGeneratingModel ? '生成中' : '思考中'}`}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoadingSpinner size="sm" />
                  <span className="text-xs sm:text-sm">{isGeneratingModel ? '生成中' : '思考中'}</span>
                </div>
              </div>
            </div>
          )}

          {/* 流式输出 */}
          {isStreaming && streamingContent && (
            <div className="chat-message flex gap-2 sm:gap-3 p-3 sm:p-4">
              <div className="flex h-6 w-6 sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Bot className="h-3 w-3 sm:h-4 sm:w-4" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <span className="font-medium">AI助手</span>
                  <span className="loading-dots">正在回复</span>
                </div>

                {/* 推理过程 */}
                {reasoningContent && (
                  <div className="reasoning-panel">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      <span className="font-medium text-sm">推理过程</span>
                    </div>
                    <div className="whitespace-pre-wrap text-xs sm:text-sm">
                      {reasoningContent}
                      <span className="stream-cursor" />
                    </div>
                  </div>
                )}

                <div className="message-content">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code: renderCode,
                      pre: ({ children }) => <div>{children}</div>,
                    }}
                  >
                    {streamingContent}
                  </ReactMarkdown>
                  <span className="stream-cursor" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
