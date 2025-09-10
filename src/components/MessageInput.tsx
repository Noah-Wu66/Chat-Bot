'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Send, Paperclip, X, Image as ImageIcon, Search, Brain, AlignLeft, ListFilter, ChevronDown, AlertTriangle, Square, Video, SlidersHorizontal, Palette } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { MODELS, ModelId } from '@/lib/types';
import { cn, fileToBase64, compressImageSmart } from '@/utils/helpers';
import ModelSelector from './ModelSelector';

interface MessageInputProps {
  onSendMessage: (content: string, images?: string[], media?: { audios?: string[]; videos?: string[] }) => void;
  disabled?: boolean;
  // UI 变体：默认底部输入，或首页居中大输入
  variant?: 'default' | 'center';
  placeholder?: string;
  autoFocus?: boolean;
  onStop?: () => void;
  // 编辑模式支持
  initialValue?: string;
  initialImages?: string[];
  isEditing?: boolean;
  onCancelEdit?: () => void;
}

export default function MessageInput({ onSendMessage, disabled, variant = 'default', placeholder, autoFocus, onStop, initialValue, initialImages, isEditing, onCancelEdit }: MessageInputProps) {
  const [message, setMessage] = useState(initialValue ?? '');
  const [images, setImages] = useState<string[]>(Array.isArray(initialImages) ? initialImages : []);
  const [audios, setAudios] = useState<Array<{ url: string; name: string; type: string }>>([]);
  const [videos, setVideos] = useState<Array<{ url: string; name: string; type: string }>>([]);
  const [audioData, setAudioData] = useState<string[]>([]);
  const [videoData, setVideoData] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentModel, isStreaming, setLoginOpen, webSearchEnabled, setWebSearchEnabled, settings, setSettings, presetInputImages, setPresetInputImages } = useChatStore();
  const modelConfig = MODELS[currentModel];
  const isGeminiPro = currentModel === 'gemini-2.5-pro';

  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  // 各组件自行管理打开状态，避免跨模型互相干扰
  // 检查登录状态（不阻塞 UI）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include',
        });
        if (!cancelled) setIsLoggedIn(response.ok);
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

  // 同步外部初始值（进入/退出编辑时）
  useEffect(() => {
    if (typeof initialValue === 'string') setMessage(initialValue);
  }, [initialValue]);
  useEffect(() => {
    if (Array.isArray(initialImages)) setImages(initialImages);
  }, [initialImages]);

  // 监听预填图片（来自“将图变视频”入口）
  useEffect(() => {
    if (Array.isArray(presetInputImages) && presetInputImages.length > 0) {
      setImages(prev => [...prev, ...presetInputImages]);
      setPresetInputImages([]);
    }
  }, [presetInputImages, setPresetInputImages]);

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
    const hasAnyMedia = (images.length > 0) || (audioData.length > 0) || (videoData.length > 0);
    if (!message.trim() && !hasAnyMedia) return;
    if (disabled || isStreaming) return;
    if (isLoggedIn === false) {
      setLoginOpen(true);
      return;
    }

    onSendMessage(
      message.trim(),
      images.length > 0 ? images : undefined,
      isGeminiPro ? { audios: audioData.length > 0 ? audioData : undefined, videos: videoData.length > 0 ? videoData : undefined } : undefined
    );
    setMessage('');
    setImages([]);
    try { audios.forEach((a) => { try { URL.revokeObjectURL(a.url); } catch {} }); } catch {}
    try { videos.forEach((v) => { try { URL.revokeObjectURL(v.url); } catch {} }); } catch {}
    setAudios([]);
    setVideos([]);
    setAudioData([]);
    setVideoData([]);
    setPresetInputImages([]);

    // 重置文本框高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  // 处理文件选择
  const handleFileSelect = async (files: FileList) => {
    if (!modelConfig.supportsVision) {
      alert('当前模型不支持文件上传');
      return;
    }

    // 互斥：检测本次选择的主类别
    let pickedType: 'image' | 'audio' | 'video' | null = null;
    for (let i = 0; i < files.length; i++) {
      const t = files[i]?.type || '';
      if (!t) continue;
      if (t.startsWith('image/')) { pickedType = 'image'; break; }
      if (t.startsWith('audio/')) { pickedType = 'audio'; break; }
      if (t.startsWith('video/')) { pickedType = 'video'; break; }
    }
    if (!pickedType) return;

    // 如果已有与本次不同的类别，清空之
    const clearImages = () => setImages([]);
    const clearAudios = () => { setAudios((prev) => { prev.forEach(p => { try { URL.revokeObjectURL(p.url); } catch {} }); return []; }); setAudioData([]); };
    const clearVideos = () => { setVideos((prev) => { prev.forEach(p => { try { URL.revokeObjectURL(p.url); } catch {} }); return []; }); setVideoData([]); };
    if (pickedType === 'image' && (audios.length > 0 || videos.length > 0)) { clearAudios(); clearVideos(); }
    if (pickedType === 'audio' && (images.length > 0 || videos.length > 0)) { clearImages(); clearVideos(); }
    if (pickedType === 'video' && (images.length > 0 || audios.length > 0)) { clearImages(); clearAudios(); }

    const imageQuota = Math.max(0, 5 - images.length);
    const audioQuota = isGeminiPro ? Math.max(0, 2 - audios.length) : 0;
    const videoQuota = isGeminiPro ? Math.max(0, 2 - videos.length) : 0;

    const imageFiles: File[] = [];
    const audioFiles: File[] = [];
    const videoFiles: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      const t = f.type || '';
      if (pickedType === 'image' && t.startsWith('image/')) {
        if (imageFiles.length < imageQuota) imageFiles.push(f);
      } else if (pickedType === 'audio' && isGeminiPro && t.startsWith('audio/')) {
        if (audioFiles.length < audioQuota) audioFiles.push(f);
      } else if (pickedType === 'video' && isGeminiPro && t.startsWith('video/')) {
        if (videoFiles.length < videoQuota) videoFiles.push(f);
      }
    }

    // 处理图片（始终进行有损压缩 -> base64，控制请求体大小）
    if (imageFiles.length > 0) {
      const newImages: string[] = [];
      for (const file of imageFiles) {
        try {
          const processed = await compressImageSmart(file, { maxWidth: 1280, maxHeight: 1280, maxBytes: 1024 * 1024, initialQuality: 0.75, mimeType: 'image/webp' });
          const base64 = await fileToBase64(processed); // data:image/webp;base64,...
          newImages.push(base64);
        } catch {}
      }
      if (newImages.length > 0) setImages(prev => [...prev, ...newImages]);
    }

    // 处理音频/视频（仅本地预览，不上行）
    if (audioFiles.length > 0) {
      const newAudios = audioFiles.map((f) => ({ url: URL.createObjectURL(f), name: f.name, type: f.type || 'audio' }));
      setAudios(prev => [...prev, ...newAudios]);
      // 转 base64（data URL）用于上行
      for (const file of audioFiles) {
        try {
          const b64 = await fileToBase64(file);
          setAudioData(prev => [...prev, b64]);
        } catch {}
      }
    }
    if (videoFiles.length > 0) {
      const newVideos = videoFiles.map((f) => ({ url: URL.createObjectURL(f), name: f.name, type: f.type || 'video' }));
      setVideos(prev => [...prev, ...newVideos]);
      for (const file of videoFiles) {
        try {
          const b64 = await fileToBase64(file);
          setVideoData(prev => [...prev, b64]);
        } catch {}
      }
    }
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

  // 移除音频
  const removeAudio = (index: number) => {
    setAudios(prev => {
      const target = prev[index];
      try { if (target?.url) URL.revokeObjectURL(target.url); } catch {}
      return prev.filter((_, i) => i !== index);
    });
    setAudioData(prev => prev.filter((_, i) => i !== index));
  };

  // 移除视频
  const removeVideo = (index: number) => {
    setVideos(prev => {
      const target = prev[index];
      try { if (target?.url) URL.revokeObjectURL(target.url); } catch {}
      return prev.filter((_, i) => i !== index);
    });
    setVideoData(prev => prev.filter((_, i) => i !== index));
  };

  const canSend = (message.trim() || images.length > 0) && !disabled && !isStreaming;
  const showStop = isStreaming;


  // 统一：不再使用移动端折叠菜单，直接与桌面一致展示

  return (
    <div className={cn("relative", variant === 'center' && "max-w-2xl mx-auto")}>
      {/* 拖拽覆盖层 */}
      {isDragging && modelConfig.supportsVision && (
        <div className="drag-overlay flex items-center justify-center">
          <div className="text-center">
            <ImageIcon className="mx-auto h-8 w-8 text-primary" />
            <p className="mt-2 text-sm font-medium text-primary">
              {isGeminiPro ? '拖拽文件到这里（图片/音频/视频）' : '拖拽图片到这里'}
            </p>
          </div>
        </div>
      )}

      {/* 顶部控制栏（移动端与桌面端统一） */}
      <div className={cn("mb-2 flex items-center justify-between gap-2", variant === 'center' && "px-1") }>
        <div className="flex items-center gap-1 sm:gap-2 relative flex-wrap">
          {/* 切换模型 */}
          <ModelSelector variant="ghost" />

          {/* GPT-5 设置合并弹窗 */}
          {currentModel === 'gpt-5' && (
            <Gpt5SettingsPopover
              value={{
                web: !!webSearchEnabled,
                effort: ((settings?.reasoning?.effort as any) || 'high'),
                verbosity: ((settings?.text?.verbosity as any) || 'medium'),
                searchSize: Number(settings?.web?.size) || 10,
              }}
              disabled={disabled || isStreaming}
              onChange={(v) => {
                if (Object.prototype.hasOwnProperty.call(v, 'web')) setWebSearchEnabled(Boolean((v as any).web));
                if (Object.prototype.hasOwnProperty.call(v, 'effort')) setSettings({ reasoning: { ...(settings?.reasoning || {}), effort: (v as any).effort } });
                if (Object.prototype.hasOwnProperty.call(v, 'verbosity')) setSettings({ text: { ...(settings?.text || {}), verbosity: (v as any).verbosity } });
                if (Object.prototype.hasOwnProperty.call(v, 'searchSize')) setSettings({ web: { ...(settings?.web || {}), size: Number((v as any).searchSize) } });
              }}
              open={undefined}
              onOpenChange={undefined}
            />
          )}

          

          {/* Veo3 Fast 设置（与 GPT-5 弹窗风格统一） */}
          {currentModel === 'veo3-fast' && (
            <Veo3SettingsPopover
              value={{
                aspectRatio: (settings.veo3?.aspectRatio as any) || '16:9',
                resolution: (settings.veo3?.resolution as any) || '720p',
                generateAudio: settings.veo3?.generateAudio === true,
              }}
              disabled={disabled || isStreaming}
              onChange={(v) => setSettings({ veo3: { ...(settings.veo3 || {}), ...(v as any) } })}
              open={undefined}
              onOpenChange={undefined}
            />
          )}

          {/* Seedream 4.0 设置 */}
          {currentModel === 'seedream-4-0' && (
            <SeedreamSettingsPopover
              value={{
                size: (settings.seedream?.size as any) || '2K',
                sequentialImageGeneration: 'auto',
                maxImages: (typeof settings.seedream?.maxImages === 'number' ? settings.seedream?.maxImages : 1) as number,
                responseFormat: 'b64_json',
                watermark: false,
              }}
              disabled={disabled || isStreaming}
              onChange={(v) => setSettings({ seedream: { ...(settings.seedream || {}), ...(v as any), sequentialImageGeneration: 'auto', responseFormat: 'b64_json', watermark: false } })}
              open={undefined}
              onOpenChange={undefined}
            />
          )}
        </div>

        {/* 右侧占位 */}
        <div />
      </div>

      {/* 不再有移动端设置抽屉 */}

      {/* 桌面端单独的顶部栏已与移动端合并 */}

      {/* 媒体预览：图片 / 音频 / 视频 */}
      {(images.length > 0 || audios.length > 0 || videos.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {images.map((image, index) => (
            <div key={`img-${index}`} className="relative">
              <img
                src={image}
                alt={`上传的图片 ${index + 1}`}
                className="image-preview h-16 w-16 sm:h-20 sm:w-20"
              />
              <button
                onClick={() => removeImage(index)}
                className="absolute -top-1 -right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground hover:bg-destructive/90 touch-manipulation"
                aria-label="移除图片"
                title="移除"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          {isGeminiPro && audios.map((a, index) => (
            <div key={`aud-${index}`} className="relative flex items-center gap-1 rounded-md border px-2 py-1">
              <audio src={a.url} controls className="h-8" />
              <span className="max-w-[160px] truncate text-[11px] text-muted-foreground" title={a.name}>{a.name}</span>
              <button
                onClick={() => removeAudio(index)}
                className="absolute -top-1 -right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground hover:bg-destructive/90 touch-manipulation"
                aria-label="移除音频"
                title="移除"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          ))}

          {isGeminiPro && videos.map((v, index) => (
            <div key={`vid-${index}`} className="relative">
              <video src={v.url} controls className="h-20 w-28 rounded-md bg-black" />
              <button
                onClick={() => removeVideo(index)}
                className="absolute -top-1 -right-1 rounded-full bg-destructive p-0.5 text-destructive-foreground hover:bg-destructive/90 touch-manipulation"
                aria-label="移除视频"
                title="移除"
              >
                <X className="h-2.5 w-2.5" />
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
        
        <textarea
          ref={textareaRef}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={
            placeholder ?? (
              modelConfig.supportsVision
                ? (variant === 'center' ? "您在忙什么？" : (isGeminiPro ? "输入消息或拖拽文件..." : "输入消息或拖拽图片..."))
                : (variant === 'center' ? "您在忙什么？" : "输入消息...")
            )
          }
          className={cn(
            "chat-input w-full border-0 bg-transparent focus:ring-0 resize-none",
            variant === 'center' ? "min-h-[48px] sm:min-h-[56px] text-sm sm:text-base px-3 sm:px-5 py-2.5 sm:py-4 rounded-2xl pr-24 sm:pr-32 pl-8 sm:pl-10" : "pr-20 sm:pr-28 pl-6 sm:pl-8 py-2 sm:py-3"
          )}
          disabled={disabled || isStreaming}
          rows={1}
          autoFocus={autoFocus}
        />

        {/* 操作按钮 */}
        <div className={cn(
          "absolute flex items-center gap-0.5 sm:gap-1",
          variant === 'center' ? "right-1.5 bottom-1.5 sm:right-2 sm:bottom-2" : "right-1 bottom-1 sm:right-2 sm:bottom-2"
        )}>
          {/* 附件按钮 */}
          {modelConfig.supportsVision && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={isGeminiPro ? "image/*,audio/*,video/*" : "image/*"}
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
                disabled={(() => {
                  if (disabled || isStreaming) return true;
                  if (!isGeminiPro) return images.length >= 5;
                  const canMore = (images.length < 5) || (audios.length < 2) || (videos.length < 2);
                  return !canMore;
                })()}
                className={cn(
                  "compact rounded-md p-1 sm:p-1.5 md:p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground touch-manipulation",
                  "disabled:pointer-events-none disabled:opacity-50"
                )}
                title={isGeminiPro ? "上传文件" : "上传图片"}
              >
                <Paperclip className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </button>
            </>
          )}

          {/* 发送/停止合并按钮：根据状态自动切换 */}
          <button
            type="button"
            onClick={() => { if (showStop) { onStop && onStop(); } else { handleSend(); } }}
            disabled={!showStop && !canSend}
            className={cn(
              "compact rounded-md p-1 sm:p-1.5 md:p-2 transition-colors touch-manipulation",
              showStop
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : (canSend
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-muted-foreground cursor-not-allowed opacity-50")
            )}
            title={showStop ? "停止" : (isEditing ? "保存并重新生成" : "发送消息 (Enter)")}
          >
            {showStop ? <Square className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />}
          </button>
        </div>
      </div>

      {isEditing && (
        <div className={cn("mt-2 flex items-center justify-end gap-2", variant === 'center' && "px-1")}>
          <button
            type="button"
            onClick={() => { if (onCancelEdit) onCancelEdit(); }}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            title="取消编辑"
          >
            取消
          </button>
        </div>
      )}

      {/* 提示信息 */}
      <div className={cn("mt-2 flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2", variant === 'center' && "px-1")}>
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
          {/* 未登录提示 */}
          {isLoggedIn === false && (
            <button
              type="button"
              onClick={() => setLoginOpen(true)}
              className="text-primary hover:underline touch-manipulation"
            >请登录</button>
          )}
          <span className="hidden sm:inline">Enter 发送，Shift+Enter 换行</span>
          <span className="sm:hidden">Enter 发送</span>
          {modelConfig.supportsVision && (
            isGeminiPro
              ? <span className="hidden sm:inline">支持文件上传 图片({images.length}/5){audios.length>0?` 音频(${audios.length}/2)`:''}{videos.length>0?` 视频(${videos.length}/2)`:''}</span>
              : <span className="hidden sm:inline">支持图片上传 ({images.length}/5)</span>
          )}
        </div>
        {message.length > 0 && (
          <span className="shrink-0">{message.length} 字符</span>
        )}
      </div>
    </div>
  );
}

function EffortPopover({ value, disabled, onChange, open, onOpenChange }: { value: 'minimal' | 'low' | 'medium' | 'high'; disabled?: boolean; onChange: (v: 'minimal' | 'low' | 'medium' | 'high') => void; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? (open as boolean) : innerOpen;
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

function Veo3SettingsPopover({
  value,
  disabled,
  onChange,
  open,
  onOpenChange,
}: {
  value: { aspectRatio: '16:9' | '9:16' | '1:1'; resolution: '720p' | '1080p'; generateAudio: boolean };
  disabled?: boolean;
  onChange: (v: Partial<{ aspectRatio: '16:9' | '9:16' | '1:1'; resolution: '720p' | '1080p'; generateAudio: boolean }>) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? (open as boolean) : innerOpen;
  const toggle = () => (onOpenChange ? onOpenChange(!isOpen) : setInnerOpen((o) => !o));
  const summary = `${value.aspectRatio} · ${value.resolution}${value.generateAudio ? ' · 音频' : ''}`;
  const setAspect = (ar: '16:9' | '9:16' | '1:1') => onChange({ aspectRatio: ar });
  const setRes = (r: '720p' | '1080p') => onChange({ resolution: r });
  const setAudio = (v: boolean) => onChange({ generateAudio: v });
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
        title="Veo3 设置"
      >
        <Video className="h-3.5 w-3.5" />
        <span>{summary}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 w-[260px] rounded-md border bg-background p-2 text-xs shadow">
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">画幅比例</div>
            <div className="grid grid-cols-3 gap-1">
              {(['16:9','9:16','1:1'] as const).map((ar) => (
                <button
                  key={ar}
                  type="button"
                  disabled={disabled}
                  onClick={() => setAspect(ar)}
                  className={cn(
                    "rounded-md border px-2 py-1",
                    value.aspectRatio === ar ? "bg-accent text-accent-foreground border-transparent" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {ar}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">分辨率</div>
            <div className="grid grid-cols-2 gap-1">
              {(['720p','1080p'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  disabled={disabled}
                  onClick={() => setRes(r)}
                  className={cn(
                    "rounded-md border px-2 py-1",
                    value.resolution === r ? "bg-accent text-accent-foreground border-transparent" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center justify-between rounded-md border px-2 py-1">
            <span>生成音频</span>
            <input
              type="checkbox"
              className="accent-primary"
              disabled={disabled}
              checked={value.generateAudio}
              onChange={(e) => setAudio(e.target.checked)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Gpt5SettingsPopover({
  value,
  disabled,
  onChange,
  open,
  onOpenChange,
}: {
  value: { web: boolean; effort: 'minimal' | 'low' | 'medium' | 'high'; verbosity: 'low' | 'medium' | 'high'; searchSize: number };
  disabled?: boolean;
  onChange: (v: Partial<{ web: boolean; effort: 'minimal' | 'low' | 'medium' | 'high'; verbosity: 'low' | 'medium' | 'high'; searchSize: number }>) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? (open as boolean) : innerOpen;
  const toggle = () => (onOpenChange ? onOpenChange(!isOpen) : setInnerOpen((o) => !o));
  const effortLabelMap: Record<'minimal' | 'low' | 'medium' | 'high', string> = { minimal: '极低', low: '较低', medium: '中等', high: '高' };
  const summary = `推理:${effortLabelMap[value.effort]} · 篇幅:${value.verbosity === 'low' ? '简洁' : value.verbosity === 'high' ? '详细' : '适中'} · 联网:${value.web ? `开(${value.searchSize})` : '关'}`;
  const effortSteps: Array<{ v: 'minimal'|'low'|'medium'|'high'; label: string }> = [
    { v: 'minimal', label: '极低' },
    { v: 'low', label: '较低' },
    { v: 'medium', label: '中等' },
    { v: 'high', label: '高' },
  ];
  const effortIdx = Math.max(0, effortSteps.findIndex((s) => s.v === value.effort));
  const setEffortIdx = (i: number) => onChange({ effort: effortSteps[Math.min(Math.max(0, i), effortSteps.length - 1)].v });
  const verbositySteps: Array<{ v: 'low'|'medium'|'high'; label: string }> = [
    { v: 'low', label: '简洁' },
    { v: 'medium', label: '适中' },
    { v: 'high', label: '详细' },
  ];
  const verbosityIdx = Math.max(0, verbositySteps.findIndex((s) => s.v === value.verbosity));
  const setVerbosityIdx = (i: number) => onChange({ verbosity: verbositySteps[Math.min(Math.max(0, i), verbositySteps.length - 1)].v });
  const searchSteps = [10, 20, 30, 40, 50, 100];
  const searchIdx = Math.max(0, searchSteps.findIndex((n) => n === value.searchSize));
  const setSearchIdx = (i: number) => onChange({ searchSize: searchSteps[Math.min(Math.max(0, i), searchSteps.length - 1)] });
  const showSearchWarn = value.web && value.searchSize >= 50;
  const showEffortWarn = effortIdx >= 2;
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
        title="GPT-5 设置"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        <span>{summary}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 w-[280px] rounded-md border bg-background p-2 text-xs shadow">
          <div className="mb-2">
            <label className="flex items-center justify-between rounded-md border px-2 py-1">
              <div className="flex items-center gap-2 text-[11px]"><Search className="h-3.5 w-3.5" />联网搜索</div>
              <input
                type="checkbox"
                className="accent-primary"
                disabled={disabled}
                checked={value.web}
                onChange={(e) => onChange({ web: e.target.checked })}
              />
            </label>
          </div>
          {value.web && (
            <div className="mb-2">
              <div className="mb-1 text-[11px] text-muted-foreground">搜索深度</div>
              <div className="mb-2 flex items-center justify-between">
                {searchSteps.map((n, i) => (
                  <span key={n} className={cn("px-1", i === searchIdx ? "text-foreground" : "text-muted-foreground")}>{n}</span>
                ))}
              </div>
              <input
                type="range"
                min={0}
                max={searchSteps.length - 1}
                step={1}
                value={searchIdx}
                onChange={(e) => setSearchIdx(parseInt(e.target.value))}
                className="w-full"
              />
              {showSearchWarn && (
                <div className="mt-2 flex items-start gap-1 text-[11px] text-amber-600">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                  <span>来源过多会增加幻觉，仅在需要多来源验证时使用。</span>
                </div>
              )}
            </div>
          )}
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">推理深度</div>
            <div className="mb-2 flex items-center justify-between">
              {effortSteps.map((s, i) => (
                <span key={s.v} className={cn("px-1", i === effortIdx ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={effortSteps.length - 1}
              step={1}
              value={effortIdx}
              onChange={(e) => setEffortIdx(parseInt(e.target.value))}
              className="w-full"
            />
            {showEffortWarn && (
              <div className="mt-2 flex items-start gap-1 text-[11px] text-amber-600">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5" />
                <span>较高推理深度会显著延长思考时间。</span>
              </div>
            )}
          </div>
          <div>
            <div className="mb-1 text-[11px] text-muted-foreground">输出篇幅</div>
            <div className="mb-2 flex items-center justify-between">
              {verbositySteps.map((s, i) => (
                <span key={s.v} className={cn("px-1", i === verbosityIdx ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={verbositySteps.length - 1}
              step={1}
              value={verbosityIdx}
              onChange={(e) => setVerbosityIdx(parseInt(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SeedreamSettingsPopover({
  value,
  disabled,
  onChange,
  open,
  onOpenChange,
}: {
  value: { size: string; sequentialImageGeneration: 'auto' | 'on' | 'off'; maxImages: number; responseFormat: 'url' | 'b64_json'; watermark: boolean };
  disabled?: boolean;
  onChange: (v: Partial<{ size: string; sequentialImageGeneration: 'auto' | 'on' | 'off'; maxImages: number; responseFormat: 'url' | 'b64_json'; watermark: boolean }>) => void;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isControlled = typeof open === 'boolean';
  const isOpen = isControlled ? (open as boolean) : innerOpen;
  const toggle = () => (onOpenChange ? onOpenChange(!isOpen) : setInnerOpen((o) => !o));
  const summary = `${value.size} · 连续:auto · Base64`;

  const sizes = ['1K', '2K', '4K'];
  const seqOptions: Array<'auto'|'on'|'off'> = ['auto'];
  const fmtOptions: Array<'url'|'b64_json'> = ['b64_json'];

  const setSize = (s: string) => onChange({ size: s });
  const setSeq = (s: 'auto'|'on'|'off') => onChange({ sequentialImageGeneration: s });
  const setFmt = (f: 'url'|'b64_json') => onChange({ responseFormat: f });
  const setMax = (n: number) => onChange({ maxImages: Math.max(1, Math.min(10, Math.floor(n || 1))) });
  const setWatermark = (w: boolean) => onChange({ watermark: w });

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
        title="Seedream 设置"
      >
        <Palette className="h-3.5 w-3.5" />
        <span>{summary}</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 z-10 w-[280px] rounded-md border bg-background p-2 text-xs shadow">
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">分辨率</div>
            <div className="grid grid-cols-3 gap-1">
              {sizes.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSize(s)}
                  className={cn(
                    "rounded-md border px-2 py-1",
                    value.size === s ? "bg-accent text-accent-foreground border-transparent" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {/* 连续生成固定为 auto，隐藏交互 */}
          {/* 返回格式固定为 b64_json，隐藏交互 */}
          <div className="mb-2">
            <div className="mb-1 text-[11px] text-muted-foreground">最大生成张数</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={10}
                value={Math.max(1, Math.min(10, Number(value.maxImages || 1)))}
                onChange={(e) => setMax(parseInt(e.target.value))}
                disabled={disabled}
                className="w-16 rounded-md border px-2 py-1 bg-background"
              />
              <span className="text-[11px] text-muted-foreground">1-10</span>
            </div>
          </div>
          {/* 水印固定为关闭，隐藏交互 */}
        </div>
      )}
    </div>
  );
}
