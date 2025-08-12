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
    effort?: 'minimal' | 'low' | 'medium' | 'high';
    searchUsed?: boolean;
    tokensUsed?: number;
  };
}

// 对话会话类型
export interface Conversation {
  id: string;
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
  reasoning?: {
    effort: 'minimal' | 'low' | 'medium' | 'high';
  };
  text?: {
    verbosity: 'low' | 'medium' | 'high';
  };
  webSearch?: boolean;
  stream?: boolean;
}

// 支持的模型列表
export const MODELS: Record<string, ModelConfig> = {
  // GPT-4o 系列
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
  'gpt-4o-mini': {
    name: 'GPT-4o Mini',
    description: '轻量级多模态模型，性价比高',
    type: 'chat',
    supportsVision: true,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: false,
    maxTokens: 4096,
  },
  // 搜索模型
  'gpt-4o-search-preview': {
    name: 'GPT-4o Search',
    description: '支持网络搜索的 GPT-4o',
    type: 'chat',
    supportsVision: true,
    supportsSearch: true,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: false,
    maxTokens: 4096,
  },
  'gpt-4o-mini-search-preview': {
    name: 'GPT-4o Mini Search',
    description: '支持网络搜索的 GPT-4o Mini',
    type: 'chat',
    supportsVision: true,
    supportsSearch: true,
    supportsTools: true,
    supportsReasoning: false,
    supportsVerbosity: false,
    maxTokens: 4096,
  },
  // GPT-5 系列
  'gpt-5': {
    name: 'GPT-5',
    description: '最新的推理模型，支持深度思考',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    maxTokens: 8192,
  },
  'gpt-5-chat-latest': {
    name: 'GPT-5 Chat Latest',
    description: '支持 temperature 的 GPT-5 聊天模型',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    supportsTemperature: true,
    maxTokens: 8192,
  },
  'gpt-5-mini': {
    name: 'GPT-5 Mini',
    description: '轻量级推理模型',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    maxTokens: 4096,
  },
  'gpt-5-nano': {
    name: 'GPT-5 Nano',
    description: '超轻量级推理模型',
    type: 'responses',
    supportsVision: false,
    supportsSearch: false,
    supportsTools: true,
    supportsReasoning: true,
    supportsVerbosity: true,
    maxTokens: 2048,
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

// 错误类型
export interface APIError {
  message: string;
  type: string;
  code?: string;
  status?: number;
}
