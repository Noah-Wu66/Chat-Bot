// 消息类型定义
export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  timestamp: Date;
  model?: string;
  images?: string[];
  functionCall?: {
    name: string;
    arguments: string;
  };
  functionResult?: {
    name: string;
    result: string;
  };
  metadata?: {
    reasoning?: string;
    verbosity?: 'low' | 'medium' | 'high';
    reasoningLevel?: ReasoningLevel; // 新增：使用的推理级别
    routingDecision?: RoutingDecision; // 新增：路由决策信息
    searchUsed?: boolean;
    tokensUsed?: number;
  };
}

// 对话会话类型
export interface Conversation {
  id: string;
  userId: string; // 新增：所属用户
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
  model: string;
  settings: ConversationSettings;
}

// 对话设置
export interface ConversationSettings {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  text?: {
    verbosity: 'low' | 'medium' | 'high';
  };
  webSearch?: boolean;
  stream?: boolean;
  // 新增：路由相关设置
  routing?: {
    enabled: boolean; // 是否启用智能路由
    preferQuality: boolean; // 偏好质量还是速度
    customReasoningLevel?: ReasoningLevel; // 自定义推理级别
  };
}

// 支持的模型列表
export const MODELS: Record<string, ModelConfig> = {
  // GPT-4o
  'gpt-4o': {
    name: 'GPT-4o',
    description: '最新的多模态模型，支持文本和图像',
    type: 'chat',
    supportsVision: true,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: false,
    maxTokens: 4096,
  },
  // GPT-5
  'gpt-5': {
    name: 'GPT-5',
    description: '最新的推理模型，支持深度思考',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    supportsTemperature: false, // 手册：GPT-5 默认不支持 temperature/top_p
    maxTokens: 8192,
  },
  // GPT-5 Mini
  'gpt-5-mini': {
    name: 'GPT-5 Mini',
    description: '轻量级推理模型，适合中等复杂度任务',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    supportsTemperature: false,
    maxTokens: 4096,
  },
  // GPT-5 Nano（隐藏模型，用于路由和处理简单任务）
  'gpt-5-nano': {
    name: 'GPT-5 Nano',
    description: '超轻量推理模型，主要用于路由判断和简单问题',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    supportsTemperature: false,
    maxTokens: 2048,
  },
};

// 扩展的模型配置，包含路由信息
export const EXTENDED_MODELS: Record<ModelId, ExtendedModelConfig> = {
  'gpt-4o': {
    ...MODELS['gpt-4o'],
    availableReasoningLevels: ['high'], // GPT-4o 不支持推理级别，默认 high
    defaultReasoningLevel: 'high',
    routingPriority: 4, // 不参与自动路由
  },
  'gpt-5': {
    ...MODELS['gpt-5'],
    availableReasoningLevels: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningLevel: 'medium',
    routingPriority: 1, // 最高优先级
  },
  'gpt-5-mini': {
    ...MODELS['gpt-5-mini'],
    availableReasoningLevels: ['high'],
    defaultReasoningLevel: 'high',
    routingPriority: 2,
  },
  'gpt-5-nano': {
    ...MODELS['gpt-5-nano'],
    availableReasoningLevels: ['high'],
    defaultReasoningLevel: 'high',
    routingPriority: 3,
  },
};

export type ModelId = keyof typeof MODELS;

// 模型配置类型
export interface ModelConfig {
  name: string;
  description: string;
  type: 'chat' | 'responses';
  supportsVision?: boolean;
  supportsSearch?: boolean;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
  supportsVerbosity?: boolean;
  supportsTemperature?: boolean;
  maxTokens: number;
}

// 类型安全的模型配置获取函数
export function getModelConfig(model: ModelId): ModelConfig {
  return MODELS[model] as ModelConfig;
}

// 获取扩展模型配置
export function getExtendedModelConfig(model: ModelId): ExtendedModelConfig {
  return EXTENDED_MODELS[model] as ExtendedModelConfig;
}

// API 响应类型
export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
      function_call?: {
        name: string;
        arguments: string;
      };
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// 流式响应类型
export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string;
      function_call?: {
        name?: string;
        arguments?: string;
      };
    };
    finish_reason?: string;
  }[];
}

// 函数调用工具定义
export interface Tool {
  type: 'function';
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, any>;
    required: string[];
  };
}

// 图像输入类型
export interface ImageInput {
  type: 'input_image';
  image_url: string;
}

// 文本输入类型
export interface TextInput {
  type: 'input_text';
  text: string;
}

// 混合输入类型
export type ContentInput = TextInput | ImageInput;

// 用户类型定义
export interface User {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

// 推理级别枚举
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high';

// 扩展的模型配置
export interface ExtendedModelConfig extends ModelConfig {
  availableReasoningLevels: ReasoningLevel[];
  defaultReasoningLevel: ReasoningLevel;
  routingPriority: number; // 路由优先级，数字越小优先级越高
}

// 复杂度分析结果
export interface ComplexityAnalysis {
  score: number; // 复杂度分数 0-100
  factors: {
    textLength: number;
    questionType: 'factual' | 'analytical' | 'creative' | 'technical';
    domainSpecific: boolean;
    multiStep: boolean;
    requiresReasoning: boolean;
  };
  category: 'simple' | 'medium' | 'complex';
}

// 路由决策结果
export interface RoutingDecision {
  targetModel: ModelId;
  reasoningLevel: ReasoningLevel;
  confidence: number; // 决策置信度 0-1
  reasoning: string; // 决策理由
  fallbackModel?: ModelId; // 备选模型
}

// 路由上下文
export interface RoutingContext {
  userId?: string;
  conversationId?: string;
  responseTimeRequirement?: 'fast' | 'normal' | 'quality';
  previousModel?: ModelId; // 上一次使用的模型
  userPreferences?: {
    preferQuality: boolean;
    preferSpeed: boolean;
    maxCost?: number;
  };
}

// 路由配置
export interface RouterConfig {
  models: Record<ModelId, ExtendedModelConfig>;
  thresholds: {
    simpleComplexity: number; // 简单问题阈值
    mediumComplexity: number; // 中等复杂度阈值
    fastResponseTime: number; // 快速响应时间要求(ms)
  };
  fallbackStrategy: 'conservative' | 'aggressive';
  enableLogging: boolean;
}

// 路由日志
export interface RoutingLog {
  id: string;
  timestamp: Date;
  inputHash: string; // 输入内容的哈希值（隐私保护）
  complexityAnalysis: ComplexityAnalysis;
  routingDecision: RoutingDecision;
  executionTime: number;
  success: boolean;
  errorMessage?: string;
  responseQuality?: number; // 可选的响应质量评分
}

// 路由错误类型
export class RoutingError extends Error {
  constructor(
    message: string,
    public code: string,
    public fallbackModel?: ModelId
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

// 错误类型
export interface APIError {
  message: string;
  type: string;
  code?: string;
  status?: number;
}
