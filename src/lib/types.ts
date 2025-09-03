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
  stream?: boolean;
}

// 支持的模型列表（仅对外可用：GPT-4o 与 GPT-5）
export const MODELS: Record<string, ModelConfig> = {
  // GPT-4o（面向聊天，多模态）
  'gpt-4o': {
    name: 'GPT-4o',
    description: '多模态对话模型，支持文本和图像',
    type: 'chat',
    supportsVision: true,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: false,
    maxTokens: 4096,
  },
  // GPT-5（面向 Responses API 的推理模型）
  'gpt-5': {
    name: 'GPT-5',
    description: '最新的推理模型，支持深度思考',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    supportsTemperature: false, // GPT-5 不支持 temperature/top_p
    maxTokens: 8192,
  },

  // 兼容性别名（不在 UI 中展示，仅为旧数据兜底）：
  'gpt-4o-mini': {
    name: 'GPT-4o',
    description: '多模态对话模型，支持文本和图像',
    type: 'chat',
    supportsVision: true,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: false,
    maxTokens: 4096,
  },
  'gpt-5-chat': {
    name: 'GPT-5 Chat',
    description: '无推理的对话模型（Responses API 通道）',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: true,
    supportsTemperature: true, // 通过 Responses API 也可不传温度，此处设置为 true 仅用于 UI 控制
    maxTokens: 8192,
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
export function getModelConfig(model: ModelId): ModelConfig {
  return MODELS[model] as ModelConfig;
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

// 错误类型
export interface APIError {
  message: string;
  type: string;
  code?: string;
  status?: number;
}
