'use client';

import { useState } from 'react';
import { ChevronDown, Zap, Search, Brain, MessageSquare } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { createConversationAction } from '@/app/actions/conversations';
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

  const getModelIcon = (model: ModelId) => {
    const config = getModelConfig(model);
    if (config.supportsSearch) return Search;
    if (config.supportsReasoning) return Brain;
    if (config.type === 'responses') return Zap;
    return MessageSquare;
  };

  const getModelBadgeClass = (model: ModelId) => {
    const config = getModelConfig(model);
    if (config.supportsSearch) return 'model-badge search';
    if (config.supportsReasoning) return 'model-badge responses';
    return 'model-badge chat';
  };

  const modelGroups = {
    '可用模型': ['gpt-5', 'gemini-image'],
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
          {variant !== 'ghost' && (
            <span className={getModelBadgeClass(currentModel)}>
              {currentModelConfig.type === 'responses' ? 'Responses' : 'Chat'}
            </span>
          )}
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
          
          {/* 下拉菜单 */}
          <div className="absolute top-full left-0 z-20 mt-1 w-full min-w-[320px] rounded-lg border border-border bg-popover p-1 shadow-lg">
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
                            const newConv = await createConversationAction({ title, model, settings } as any);
                            setCurrentConversation({ ...newConv, messages: [] } as any);
                            addConversation({ ...newConv, messages: [] } as any);
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
                            <span className={getModelBadgeClass(model)}>
                              {config.type === 'responses' ? 'Responses' : 'Chat'}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {config.description}
                          </p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {config.supportsVision && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                                视觉
                              </span>
                            )}
                            {config.supportsSearch && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                搜索
                              </span>
                            )}
                            {config.supportsTools && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                                工具
                              </span>
                            )}
                            {config.supportsReasoning && (
                              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                                推理
                              </span>
                            )}
                          </div>
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
