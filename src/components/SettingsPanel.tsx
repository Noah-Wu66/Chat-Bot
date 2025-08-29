'use client';

import { Settings, X, RotateCcw, Info } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { getModelConfig } from '@/lib/types';
import { cn } from '@/utils/helpers';

export default function SettingsPanel() {
  const { 
    settingsOpen, 
    setSettingsOpen, 
    settings, 
    setSettings, 
    currentModel 
  } = useChatStore();

  const modelConfig = getModelConfig(currentModel);

  // 重置设置
  const resetSettings = () => {
    setSettings({
      temperature: 0.8,
      maxTokens: 4096,
      topP: 1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      text: { verbosity: 'medium' },
      stream: true,
    });
  };

  // 滑块组件
  const Slider = ({ 
    label, 
    value, 
    onChange, 
    min, 
    max, 
    step, 
    description,
    disabled = false 
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
    min: number;
    max: number;
    step: number;
    description?: string;
    disabled?: boolean;
  }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-sm text-muted-foreground">{value}</span>
      </div>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="slider-track">
        <div 
          className="slider-range" 
          style={{ width: `${((value - min) / (max - min)) * 100}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );

  // 选择组件
  const Select = ({ 
    label, 
    value, 
    onChange, 
    options, 
    description,
    disabled = false 
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
    description?: string;
    disabled?: boolean;
  }) => (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  // 开关组件
  const Switch = ({ 
    label, 
    checked, 
    onChange, 
    description,
    disabled = false 
  }: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    description?: string;
    disabled?: boolean;
  }) => (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <label className="text-sm font-medium">{label}</label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary" : "bg-input"
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    </div>
  );

  if (!settingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed left-1/2 top-1/2 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-lg">
        <div className="flex max-h-[85vh] flex-col">
          {/* 头部 */}
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              <h2 className="text-lg font-semibold">对话设置</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={resetSettings}
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                title="重置设置"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={() => setSettingsOpen(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 设置内容 */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* 模型信息 */}
            <div className="settings-panel">
              <h3 className="font-medium mb-3">当前模型</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{modelConfig.name}</span>
                  <span className={cn(
                    "model-badge",
                    modelConfig.type === 'responses' ? 'responses' : 'chat'
                  )}>
                    {modelConfig.type === 'responses' ? 'Responses' : 'Chat'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {modelConfig.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {modelConfig.supportsVision && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                      视觉
                    </span>
                  )}
                  {modelConfig.supportsSearch && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                      搜索
                    </span>
                  )}
                  {modelConfig.supportsTools && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                      工具
                    </span>
                  )}
                  {modelConfig.supportsReasoning && (
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                      推理
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* 基础参数 */}
            <div className="settings-panel">
              <h3 className="font-medium mb-3">基础参数</h3>
              <div className="space-y-4">
                {/* Temperature */}
                {modelConfig.supportsTemperature !== false && (
                  <Slider
                    label="Temperature"
                    value={settings.temperature || 0.8}
                    onChange={(value) => setSettings({ temperature: value })}
                    min={0}
                    max={2}
                    step={0.1}
                    description="控制输出的随机性，值越高越随机"
                  />
                )}

                {/* Max Tokens / Max Output Tokens */}
                <Slider
                  label={modelConfig.type === 'chat' ? '最大 Token 数' : '最大输出 Token 数'}
                  value={settings.maxTokens || 4096}
                  onChange={(value) => setSettings({ maxTokens: Math.round(value) })}
                  min={1}
                  max={modelConfig.maxTokens}
                  step={1}
                  description={modelConfig.type === 'chat' ? '限制回复的最大长度' : '限制回复的最大输出长度（Responses）'}
                />

                {/* Top P - 仅 Chat 可用 */}
                {modelConfig.type === 'chat' && (
                  <Slider
                    label="Top P"
                    value={settings.topP || 1}
                    onChange={(value) => setSettings({ topP: value })}
                    min={0}
                    max={1}
                    step={0.05}
                    description="核采样参数，控制词汇选择的多样性"
                  />
                )}

                {/* Frequency Penalty - 仅 Chat 可用 */}
                {modelConfig.type === 'chat' && (
                  <Slider
                    label="频率惩罚"
                    value={settings.frequencyPenalty || 0}
                    onChange={(value) => setSettings({ frequencyPenalty: value })}
                    min={-2}
                    max={2}
                    step={0.1}
                    description="减少重复内容的出现"
                  />
                )}

                {/* Presence Penalty - 仅 Chat 可用 */}
                {modelConfig.type === 'chat' && (
                  <Slider
                    label="存在惩罚"
                    value={settings.presencePenalty || 0}
                    onChange={(value) => setSettings({ presencePenalty: value })}
                    min={-2}
                    max={2}
                    step={0.1}
                    description="鼓励谈论新话题"
                  />
                )}
              </div>
            </div>

            

            

            {/* 帮助信息 */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-medium mb-1">设置说明</p>
                  <ul className="space-y-1 text-xs">
                    <li>• 设置会自动保存并应用到新对话</li>
                    <li>• 不同模型支持的参数可能不同</li>
                    <li>• GPT-5 会自动根据问题难度选择模型</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
