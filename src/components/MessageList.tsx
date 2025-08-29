'use client';

import { useEffect, useRef } from 'react';
import { User, Bot, Copy, Brain } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Message } from '@/lib/types';
import { formatTime, copyToClipboard, cn } from '@/utils/helpers';
import LoadingSpinner from './LoadingSpinner';

interface MessageListProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
  reasoningContent?: string;
}

export default function MessageList({
  messages,
  isStreaming,
  streamingContent,
  reasoningContent
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    try {
      // 打点：观察渲染列表长度与流式临时内容长度
      // eslint-disable-next-line no-console
      console.log('[Chat] render messages', { count: messages?.length || 0, hasStream: !!streamingContent, streamLen: streamingContent?.length || 0 });
    } catch {}
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
          "chat-message flex gap-3 p-4",
          isUser && "flex-row-reverse bg-muted/30",
          isSystem && "bg-accent/50"
        )}
      >
        {/* 头像 */}
        <div className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
        )}>
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </div>

        {/* 消息内容 */}
        <div className="flex-1 space-y-2">
          {/* 消息头部 */}
          <div className={cn(
            "flex items-center gap-2 text-sm text-muted-foreground",
            isUser && "flex-row-reverse"
          )}>
            <span className="font-medium">
              {isUser ? '你' : isSystem ? '系统' : 'AI助手'}
            </span>
            {message.model && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {message.model}
              </span>
            )}
            <span>{formatTime(message.timestamp)}</span>
          </div>

          {/* 图片 */}
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {message.images.map((image, imgIndex) => (
                <img
                  key={imgIndex}
                  src={image}
                  alt={`消息图片 ${imgIndex + 1}`}
                  className="image-preview max-h-32"
                />
              ))}
            </div>
          )}

          {/* 推理过程 */}
          {message.metadata?.reasoning && (
            <div className="reasoning-panel">
              <div className="flex items-center gap-2 mb-2">
                <Brain className="h-4 w-4" />
                <span className="font-medium">推理过程</span>
              </div>
              <div className="whitespace-pre-wrap text-sm">
                {message.metadata.reasoning}
              </div>
            </div>
          )}

          {/* 函数调用 */}
          {message.functionCall && (
            <div className="function-call">
              <div className="font-medium">函数调用: {message.functionCall.name}</div>
              <pre className="mt-1 text-sm overflow-x-auto">
                {message.functionCall.arguments}
              </pre>
              {message.functionResult && (
                <div className="function-result">
                  <div className="font-medium">执行结果:</div>
                  <div className="mt-1">{message.functionResult.result}</div>
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
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              {message.metadata.tokensUsed && (
                <span>Token: {message.metadata.tokensUsed}</span>
              )}
              {message.metadata.searchUsed && (
                <span className="text-green-600">使用了网络搜索</span>
              )}
            </div>
          )}

          {/* 操作：仅保留复制 */}
          {!isUser && (
            <div className="mt-1 flex items-center gap-1 text-muted-foreground">
              <button
                onClick={() => handleCopy(message.content)}
                className="rounded-full border px-2 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground"
                title="复制"
              >
                <Copy className="h-3 w-3" />
              </button>
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

          {/* 等待模型响应时的占位加载 */}
          {isStreaming && !streamingContent && (
            <div className="chat-message flex gap-3 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium">AI助手</span>
                  <span className="loading-dots">AI正在思考中</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <LoadingSpinner size="sm" />
                  <span>思考中</span>
                </div>
              </div>
            </div>
          )}

          {/* 流式输出 */}
          {isStreaming && streamingContent && (
            <div className="chat-message flex gap-3 p-4">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Bot className="h-4 w-4" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="font-medium">AI助手</span>
                  <span className="loading-dots">正在回复</span>
                </div>

                {/* 推理过程 */}
                {reasoningContent && (
                  <div className="reasoning-panel">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="h-4 w-4" />
                      <span className="font-medium">推理过程</span>
                    </div>
                    <div className="whitespace-pre-wrap text-sm">
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
