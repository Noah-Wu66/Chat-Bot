'use client';

import { useState } from 'react';
import { ChevronDown, Zap, Search, Brain, MessageSquare } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { generateTitleFromMessage } from '@/utils/helpers';
import { MODELS, ModelId, getModelConfig } from '@/lib/types';
import { cn } from '@/utils/helpers';

interface Props {
  variant?: 'default' | 'ghost';
}

export default function ModelSelector({ variant = 'default' }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { currentModel, setCurrentModel, currentConversation, setCurrentConversation, addConversation, settings } = useChatStore();

  const currentModelConfig = getModelConfig(currentModel);

  const BananaIcon = ({ className }: { className?: string }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      stroke="currentColor"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 14c2 4 6 7 11 7 3 0 4.5-1 5.5-2.5-2 1-4 1-6 .5-3-.9-5.5-3.5-6.5-7z" />
      <path d="M4 10c1-3 3-5 6-6 1.5-.5 3-.5 4.5 0-.8 1.2-1.2 2.6-1.2 4.1 0 1 .2 2 .5 2.9" />
    </svg>
  );

  const OpenAIIcon = ({ className }: { className?: string }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13.73 4.6c-.99-.57-2.47-.57-3.46 0L5.3 6.88c-.99.57-1.73 1.98-1.73 3.15v4.53c0 1.17.74 2.58 1.73 3.15l4.97 2.28c.99.57 2.47.57 3.46 0l4.97-2.28c.99-.57 1.73-1.98 1.73-3.15v-4.53c0-1.17-.74-2.58-1.73-3.15L13.73 4.6z" />
      <path d="M12 7.25v9.5" />
      <path d="M7.25 12h9.5" />
    </svg>
  );

  const GeminiIcon = ({ className }: { className?: string }) => (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="50%" stopColor="#9B72F2" />
          <stop offset="100%" stopColor="#D96570" />
        </linearGradient>
      </defs>
      <path d="M12 2c3.5 0 6 2.5 6 6 0 2-.8 3.7-2 4.9-1.2 1.2-2.9 2.1-4 2.7-1.1-.6-2.8-1.5-4-2.7C6.8 11.7 6 10 6 8c0-3.5 2.5-6 6-6z" fill="url(#g)" />
      <path d="M12 21.5c-2.2 0-4-1.8-4-4 0-1.3.6-2.4 1.4-3.2.8-.8 1.9-1.4 2.6-1.8.7.4 1.8 1 2.6 1.8.8.8 1.4 1.9 1.4 3.2 0 2.2-1.8 4-4 4z" fill="url(#g)" opacity="0.8" />
    </svg>
  );

  const getModelIcon = (model: ModelId) => {
    if (model === 'gemini-2.5-flash-image-preview') return BananaIcon as any;
    if (model === 'gpt-5') return OpenAIIcon as any;
    if (model === 'veo3-fast') return GeminiIcon as any;
    const config = getModelConfig(model);
    if (config.supportsSearch) return Search;
    if (config.supportsReasoning) return Brain;
    if (config.type === 'responses') return Zap;
    return MessageSquare;
  };

  // 取消类型/功能标签展示，仅保留标题与简介

  const modelGroups = {
    '可用模型': ['gpt-5', 'gemini-2.5-flash-image-preview', 'veo3-fast'],
  } as const;

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          variant === 'ghost'
            ? "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            : "flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground",
          variant === 'ghost' ? "bg-transparent" : "",
          isOpen && variant !== 'ghost' && "ring-2 ring-ring ring-offset-2"
        )}
      >
        <div className="flex items-center gap-2">
          {(() => {
            const Icon = getModelIcon(currentModel);
            return <Icon className="h-4 w-4" />;
          })()}
          <span className={cn("font-medium", variant === 'ghost' && "text-sm")}>{currentModelConfig.name}</span>
        </div>
        {variant !== 'ghost' && (
          <ChevronDown className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")} />
        )}
      </button>

      {isOpen && (
        <>
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          
          {/* 上弹菜单（统一为向上弹出与一致风格） */}
          <div className="absolute bottom-full left-0 z-20 mb-2 w-auto min-w-[280px] sm:min-w-[320px] max-w-[92vw] rounded-md border bg-background p-2 text-xs shadow">
            <div className="max-h-[400px] overflow-y-auto scrollbar-thin">
              {Object.entries(modelGroups).map(([groupName, models]) => (
                <div key={groupName} className="mb-2">
                  <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                    {groupName}
                  </div>
                  {models.map((modelId) => {
                    const model = modelId as ModelId;
                    const config = getModelConfig(model);
                    const Icon = getModelIcon(model);
                    const isSelected = currentModel === model;

                    return (
                      <button
                        key={model}
                        onClick={async () => {
                          if (currentModel === model) {
                            setIsOpen(false);
                            return;
                          }
                          setCurrentModel(model);
                          setIsOpen(false);
                          // 每个对话仅允许一种模型：切换模型时开启新对话
                          try {
                            const title = generateTitleFromMessage('新对话');
                            const response = await fetch('/api/conversations', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ title, model, settings }),
                              credentials: 'include',
                            });
                            if (response.ok) {
                              const newConv = await response.json();
                              setCurrentConversation({ ...newConv, messages: [] } as any);
                              addConversation({ ...newConv, messages: [] } as any);
                            }
                          } catch (e) {
                            // 静默失败
                          }
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                          "hover:bg-accent hover:text-accent-foreground",
                          isSelected && "bg-accent text-accent-foreground"
                        )}
                      >
                        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{config.name}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {config.description}
                          </p>
                          
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
