'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, X, Image as ImageIcon, Plus, Search, Brain, AlignLeft, ListFilter, ChevronDown, AlertTriangle, Square } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { MODELS, ModelId } from '@/lib/types';
import { cn, fileToBase64, compressImage } from '@/utils/helpers';
import { getCurrentUser } from '@/app/actions/auth';
import ModelSelector from './ModelSelector';

interface MessageInputProps {
  onSendMessage: (content: string, images?: string[]) => void;
  disabled?: boolean;
  // UI 变体：默认底部输入，或首页居中大输入
  variant?: 'default' | 'center';
  placeholder?: string;
  autoFocus?: boolean;
  onStop?: () => void;
}

export default function MessageInput({ onSendMessage, disabled, variant = 'default', placeholder, autoFocus, onStop }: MessageInputProps) {
  const [message, setMessage] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentModel, isStreaming, setLoginOpen, webSearchEnabled, setWebSearchEnabled, settings, setSettings } = useChatStore();
  const modelConfig = MODELS[currentModel];

  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  // 互斥弹窗：effort / verbosity / search
  const [activePopover, setActivePopover] = useState<'effort' | 'verbosity' | 'search' | null>(null);
  // 检查登录状态（不阻塞 UI）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const user = await getCurrentUser();
        if (!cancelled) setIsLoggedIn(!!user);
      } catch {
        if (!cancelled) setIsLoggedIn(false);
      }
    })();
    return () => { cancelled = true };
  }, []);

  // 自动调整文本框高度
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    adjustTextareaHeight();
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 发送消息
  const handleSend = () => {
    if (!message.trim() && images.length === 0) return;
    if (disabled || isStreaming) return;
    if (isLoggedIn === false) {
      setLoginOpen(true);
      return;
    }

    onSendMessage(message.trim(), images.length > 0 ? images : undefined);
    setMessage('');
    setImages([]);

    // 重置文本框高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // 处理文件选择
  const handleFileSelect = async (files: FileList) => {
    if (!modelConfig.supportsVision) {
      alert('当前模型不支持图像输入');
      return;
    }

    const newImages: string[] = [];

    for (let i = 0; i < Math.min(files.length, 5 - images.length); i++) {
      const file = files[i];

      if (!file.type.startsWith('image/')) {
        continue;
      }

      try {
        // 压缩图片
        const compressedFile = await compressImage(file);
        const base64 = await fileToBase64(compressedFile);
        newImages.push(base64);
      } catch (error) {
        // 处理图片失败：静默失败，避免噪声
      }
    }

    setImages(prev => [...prev, ...newImages]);
  };

  // 处理拖拽
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  };

  // 移除图片
  const removeImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const canSend = (message.trim() || images.length > 0) && !disabled && !isStreaming;


  return (
    <div className={cn("relative", variant === 'center' && "max-w-2xl mx-auto")}>
      {/* 拖拽覆盖层 */}
      {isDragging && modelConfig.supportsVision && (
        <div className="drag-overlay flex items-center justify-center">
          <div className="text-center">
            <ImageIcon className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-2 text-sm font-medium text-primary">
              拖拽图片到这里
            </p>
          </div>
        </div>
      )}

      {/* 顶部栏：模型切换 + 联网搜索开关 + 额外控制按钮 */}
      <div className={cn("mb-2 flex items-center justify-between", variant === 'center' && "px-1") }>
        <div className="flex items-center gap-2 relative">
          {/* 切换模型按钮（在联网搜索按钮左侧） */}
          <ModelSelector variant="ghost" />

          <>
            {modelConfig.supportsSearch && (
              <button
                type="button"
                onClick={() => setWebSearchEnabled(!webSearchEnabled)}
                disabled={disabled || isStreaming}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs",
                  webSearchEnabled ? "bg-green-600 text-white border-green-600" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  "disabled:pointer-events-none disabled:opacity-50"
                )}
                title={webSearchEnabled ? "已开启联网搜索" : "点击开启联网搜索"}
              >
                <Search className="h-3.5 w-3.5" />
                <span>联网搜索</span>
              </button>
            )}

            {modelConfig.supportsReasoning && (
              <EffortPopover
                value={(settings?.reasoning?.effort as any) || 'high'}
                disabled={disabled || isStreaming}
                onChange={(v) => setSettings({ reasoning: { ...(settings?.reasoning || {}), effort: v as any } })}
                open={activePopover === 'effort'}
                onOpenChange={(o) => setActivePopover(o ? 'effort' : null)}
              />
            )}

            {modelConfig.supportsVerbosity && (
              <VerbosityPopover
                value={(settings?.text?.verbosity as any) || 'medium'}
                disabled={disabled || isStreaming}
                onChange={(v) => setSettings({ text: { ...(settings?.text || {}), verbosity: v as any } })}
                open={activePopover === 'verbosity'}
                onOpenChange={(o) => setActivePopover(o ? 'verbosity' : null)}
              />
            )}

            {modelConfig.supportsSearch && webSearchEnabled && (
              <SearchSizePopover
                value={Number(settings?.web?.size) || 10}
                disabled={disabled || isStreaming}
                onChange={(v) => setSettings({ web: { ...(settings?.web || {}), size: v } })}
                open={activePopover === 'search'}
                onOpenChange={(o) => setActivePopover(o ? 'search' : null)}
              />
            )}
          </>
        </div>

        {/* 右侧占位 */}
        <div />
      </div>

      {/* 图片预览 */}
      {images.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {images.map((image, index) => (
            <div key={index} className="relative">
              <img
                src={image}
                alt={`上传的图片 ${index + 1}`}
                className="image-preview h-20 w-20"
              />
              <button
                onClick={() => removeImage(index)}
                className="absolute -top-1 -right-1 rounded-full bg-destructive p-1 text-destructive-foreground hover:bg-destructive/90"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      <div
        className={cn(
          "relative border border-input bg-background",
          isDragging && "border-primary",
          // 统一圆角风格
          variant === 'center' ? "rounded-2xl shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/70" : "rounded-2xl"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* 左侧 plus 图标（占位，不可点击）*/}
        <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">
          <Plus className="h-4 w-4" />
        </div>
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            placeholder ?? (
              modelConfig.supportsVision
                ? (variant === 'center' ? "您在忙什么？" : "输入消息或拖拽图片...")
                : (variant === 'center' ? "您在忙什么？" : "输入消息...")
            )
          }
          className={cn(
            "chat-input w-full border-0 bg-transparent pr-28 pl-8 focus:ring-0",
            variant === 'center' && "min-h-[56px] text-base px-5 py-4 rounded-2xl pr-32 pl-10"
          )}
          disabled={disabled || isStreaming}
          rows={1}
          autoFocus={autoFocus}
        />

        {/* 操作按钮 */}
        <div className={cn(
          "absolute flex items-center gap-1",
          variant === 'center' ? "right-2 bottom-2" : "right-2 bottom-2"
        )}>
          {/* 附件按钮 */}
          {modelConfig.supportsVision && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) {
                    handleFileSelect(e.target.files);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={disabled || isStreaming || images.length >= 5}
                className={cn(
                  "rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  "disabled:pointer-events-none disabled:opacity-50"
                )}
                title="上传图片"
              >
                <Paperclip className="h-4 w-4" />
              </button>
            </>
          )}

          {/* 移除语音与朗读占位按钮 */}

          {/* 发送 / 停止按钮 */}
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              disabled={disabled || !isStreaming}
              className={cn(
                "rounded-md p-2 transition-colors bg-destructive text-destructive-foreground hover:bg-destructive/90",
                "disabled:pointer-events-none disabled:opacity-50"
              )}
              title="停止生成"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "rounded-md p-2 transition-colors",
                canSend
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "text-muted-foreground cursor-not-allowed opacity-50"
              )}
              title="发送消息 (Enter)"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* 提示信息 */}
      <div className={cn("mt-2 flex items-center justify-between text-xs text-muted-foreground", variant === 'center' && "px-1")}>
        <div className="flex items-center gap-4">
          {/* 未登录提示 */}
          {isLoggedIn === false && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="text-primary hover:underline"
            >请登录</button>
          )}
          <span>Enter 发送，Shift+Enter 换行</span>
          {modelConfig.supportsVision && (
            <span>支持图片上传 ({images.length}/5)</span>
          )}
        </div>
        {message.length > 0 && (
          <span>{message.length} 字符</span>
        )}
      </div>
    </div>
  );
}

function EffortPopover({ value, disabled, onChange, open, onOpenChange }: { value: 'minimal' | 'low' | 'medium' | 'high'; disabled?: boolean; onChange: (v: 'minimal' | 'low' | 'medium' | 'high') => void; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = typeof open === 'boolean' ? open : innerOpen;
  const toggle = () => (onOpenChange ? onOpenChange(!isOpen) : setInnerOpen(o => !o));
  const steps: Array<{ v: 'minimal'|'low'|'medium'|'high'; label: string }> = [
    { v: 'minimal', label: '极低' },
    { v: 'low', label: '较低' },
    { v: 'medium', label: '中等' },
    { v: 'high', label: '高' },
  ];
  const idx = Math.max(0, steps.findIndex(s => s.v === value));
  const current = steps[idx]?.label || '较低';
  const setIdx = (i: number) => {
    const ii = Math.min(Math.max(0, i), steps.length - 1);
    onChange(steps[ii].v);
  };
  const showWarn = idx >= 2; // medium 或更高
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
        title="推理深度"
      >
        <Brain className="h-3.5 w-3.5" />
        <span>推理深度:{current}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 w-[220px] rounded-md border bg-background p-2 text-xs shadow">
          <div className="mb-2 flex items-center justify-between">
            {steps.map((s, i) => (
              <span key={s.v} className={cn("px-1", i === idx ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={steps.length - 1}
            step={1}
            value={idx}
            onChange={(e) => setIdx(parseInt(e.target.value))}
            className="w-full"
          />
          {showWarn && (
            <div className="mt-2 flex items-start gap-1 text-[11px] text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>当前推理深度过高，会极大延长模型的思考时间，仅当您需要回答极为复杂的问题时才建议使用。</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VerbosityPopover({ value, disabled, onChange, open, onOpenChange }: { value: 'low' | 'medium' | 'high'; disabled?: boolean; onChange: (v: 'low' | 'medium' | 'high') => void; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = typeof open === 'boolean' ? open : innerOpen;
  const toggle = () => (onOpenChange ? onOpenChange(!isOpen) : setInnerOpen(o => !o));
  const steps: Array<{ v: 'low'|'medium'|'high'; label: string }> = [
    { v: 'low', label: '简洁' },
    { v: 'medium', label: '适中' },
    { v: 'high', label: '详细' },
  ];
  const idx = Math.max(0, steps.findIndex(s => s.v === value));
  const current = steps[idx]?.label || '适中';
  const setIdx = (i: number) => {
    const ii = Math.min(Math.max(0, i), steps.length - 1);
    onChange(steps[ii].v);
  };
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
        title="输出篇幅"
      >
        <AlignLeft className="h-3.5 w-3.5" />
        <span>输出篇幅:{current}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 w-[220px] rounded-md border bg-background p-2 text-xs shadow">
          <div className="mb-2 flex items-center justify-between">
            {steps.map((s, i) => (
              <span key={s.v} className={cn("px-1", i === idx ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={steps.length - 1}
            step={1}
            value={idx}
            onChange={(e) => setIdx(parseInt(e.target.value))}
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}

function SearchSizePopover({ value, disabled, onChange, open, onOpenChange }: { value: number; disabled?: boolean; onChange: (v: number) => void; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = typeof open === 'boolean' ? open : innerOpen;
  const toggle = () => (onOpenChange ? onOpenChange(!isOpen) : setInnerOpen(o => !o));
  const steps = [10, 20, 30, 40, 50, 100];
  const idx = Math.max(0, steps.findIndex(s => s === value));
  const display = String(value || steps[0]);
  const setIdx = (i: number) => {
    const ii = Math.min(Math.max(0, i), steps.length - 1);
    onChange(steps[ii]);
  };
  const showWarn = (value || steps[idx]) >= 50;
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] hover:bg-accent hover:text-accent-foreground",
          "disabled:pointer-events-none disabled:opacity-50"
        )}
        title="搜索深度"
      >
        <ListFilter className="h-3.5 w-3.5" />
        <span>搜索深度:{display}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 w-[240px] rounded-md border bg-background p-2 text-xs shadow">
          <div className="mb-2 flex items-center justify-between">
            {steps.map((n, i) => (
              <span key={n} className={cn("px-1", i === idx ? "text-foreground" : "text-muted-foreground")}>{n}</span>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={steps.length - 1}
            step={1}
            value={idx}
            onChange={(e) => setIdx(parseInt(e.target.value))}
            className="w-full"
          />
          {showWarn && (
            <div className="mt-2 flex items-start gap-1 text-[11px] text-amber-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
              <span>当前来源过多，会极大的增加模型的幻觉率，仅当您需要搜索极为少见的问题或多来源验证时才建议使用。</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
