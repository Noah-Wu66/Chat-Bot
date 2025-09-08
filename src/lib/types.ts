// 消息类型定义
export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  timestamp: Date;
  model?: string;
  images?: string[];
  videos?: string[];
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
    searchUsed?: boolean;
    tokensUsed?: number;
    sources?: any[];
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
  reasoning?: {
    effort?: ReasoningEffort;
  };
  web?: {
    size?: number; // 联网搜索条目数量
  };
  stream?: boolean;
  // Veo3 Fast 专属设置
  veo3?: {
    aspectRatio?: '16:9' | '9:16' | '1:1';
    duration?: '8s';
    resolution?: '720p' | '1080p';
    generateAudio?: boolean;
    // 仅文生视频使用
    enhancePrompt?: boolean;
    autoFix?: boolean;
  };
}

// 支持的模型列表（仅保留 Gemini 2.5 Flash 图像生成）
export const MODELS: Record<string, ModelConfig> = {
  // GPT-5（面向 Responses API 的推理模型）
  'gpt-5': {
    name: 'GPT-5',
    description: '最新的推理模型，支持深度思考',
    type: 'responses',
    supportsVision: true,
    supportsSearch: true,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    supportsTemperature: false,
    maxTokens: 8192,
  },
  // Gemini 2.5 Flash 图像生成（图文多模态）
  'gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image',
    description: '图文多模态生成，文本更精准，图像更清晰',
    type: 'chat',
    supportsVision: true,
    supportsSearch: false,
    supportsTools: false,
    supportsReasoning: false,
    supportsVerbosity: false,
    supportsTemperature: true,
    maxTokens: 8192,
  },
  // Veo3 Fast（视频生成，无上下文）
  'veo3-fast': {
    name: 'Veo3 Fast',
    description: '视频生成（无上下文）：文本或图生视频',
    type: 'chat',
    supportsVision: true,
    supportsSearch: false,
    supportsTools: false,
    supportsReasoning: false,
    supportsVerbosity: false,
    supportsTemperature: false,
    maxTokens: 1,
  },
};

export type ModelId = keyof typeof MODELS;

// 路由决策类型
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';
export type VerbosityLevel = 'low' | 'medium' | 'high';

// 路由结果（用于 API 返回给前端）
export interface RoutingResult {
  model: ModelId;
  effort?: ReasoningEffort;
  verbosity?: VerbosityLevel;
}

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
export function getModelConfig(model: ModelId | string): ModelConfig {
  const config = MODELS[model as ModelId];
  if (config) return config;
  const fallbackModel = 'gpt-5' as ModelId;
  return MODELS[fallbackModel];
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
  image_url?: string;
  // Responses API 对 gpt-5 不接受 image_data，这里保留字段仅兼容其它模型
  image_data?: string;
  mime_type?: string;  // 如 'image/png'
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
  isSuperAdmin: boolean;
  isBanned: boolean;
  createdAt: Date;
}

// 错误类型
export interface APIError {
  message: string;
  type: string;
  code?: string;
  status?: number;
}
