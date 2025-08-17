import OpenAI from 'openai';
import { ModelId, MODELS, ConversationSettings, Tool } from './types';

// 初始化 OpenAI 客户端
export const openai = new OpenAI({
  apiKey: process.env.AIHUBMIX_API_KEY!,
  baseURL: process.env.AIHUBMIX_BASE_URL || 'https://aihubmix.com/v1',
});

// 生成随机种子
export const generateSeed = () => Math.floor(Math.random() * 1000000000);

// Chat Completions API 调用
export async function createChatCompletion({
  model,
  messages,
  settings,
  tools,
  stream = false,
}: {
  model: ModelId;
  messages: any[];
  settings: ConversationSettings;
  tools?: Tool[];
  stream?: boolean;
}) {
  const modelConfig = MODELS[model];
  
  // 基础参数
  const params: any = {
    model,
    messages,
    stream,
  };

  // 添加设置参数
  if (settings.temperature !== undefined && modelConfig.supportsTemperature !== false) {
    params.temperature = settings.temperature;
  }
  // max tokens: chat 用 max_tokens；responses（如 gpt-5）用 max_output_tokens
  if (settings.maxTokens) {
    if (modelConfig.type === 'chat') {
      params.max_tokens = settings.maxTokens;
    } else {
      params.max_output_tokens = settings.maxTokens;
    }
  }
  if (settings.topP !== undefined && modelConfig.type === 'chat') {
    params.top_p = settings.topP;
  }
  if (settings.frequencyPenalty !== undefined && modelConfig.type === 'chat') {
    params.frequency_penalty = settings.frequencyPenalty;
  }
  if (settings.presencePenalty !== undefined && modelConfig.type === 'chat') {
    params.presence_penalty = settings.presencePenalty;
  }
  if (settings.seed !== undefined) {
    params.seed = settings.seed;
  }

  // 添加工具支持
  if (tools && tools.length > 0 && modelConfig.supportsTools) {
    params.tools = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    params.tool_choice = 'auto';
  }

  // 添加网络搜索支持
  if (settings.webSearch && modelConfig.supportsSearch) {
    params.web_search_options = {};
  }

  return await openai.chat.completions.create(params);
}

// 使用 gpt-5-nano 判断应路由到的具体模型与推理级别（内部函数）
async function routeGpt5Model(input: string | any[]): Promise<{ model: ModelId; effort: 'minimal' | 'low' | 'medium' | 'high' }> {
  const content = typeof input === 'string' ? input : JSON.stringify(input);
  const router = await (openai as any).responses.create({
    model: 'gpt-5-nano',
    input: content,
    instructions:
      '你是模型路由器。请根据用户问题的难易程度在 gpt-5、gpt-5-mini、gpt-5-nano 中选择合适的模型，并为 gpt-5 选择推理级别。输出严格的 JSON：{"model":"gpt-5|gpt-5-mini|gpt-5-nano","effort":"minimal|low|medium|high"}。当选择 gpt-5-mini 或 gpt-5-nano 时，effort 必须为 "high"。不要输出除 JSON 外的任何字符。',
    reasoning: { effort: 'high' },
  });

  const raw =
    (router as any).output_text?.trim() ||
    (router as any).content?.trim() ||
    '';

  const validModels: ModelId[] = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
  const validEfforts = ['minimal', 'low', 'medium', 'high'] as const;

  let decision: { model: ModelId; effort: 'minimal' | 'low' | 'medium' | 'high' } = {
    model: 'gpt-5-mini',
    effort: 'high',
  };

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    const jsonText = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(jsonText);
    const m = parsed.model as ModelId;
    const e = parsed.effort as (typeof validEfforts)[number];
    if (validModels.includes(m) && validEfforts.includes(e)) {
      decision = { model: m, effort: e };
    }
  } catch (e) {
    const choice = raw.replace(/[`\s]/g, '').toLowerCase();
    const fallback = validModels.find((m) => m === choice);
    if (fallback) {
      decision = { model: fallback, effort: fallback === 'gpt-5' ? 'medium' : 'high' };
    }
  }

  if (decision.model === 'gpt-5-mini' || decision.model === 'gpt-5-nano') {
    decision.effort = 'high';
  }

  // 不在这里输出日志，统一由 API 层/前端输出
  return decision;
}

// 对外导出一个决策函数，便于在 API 层先拿到路由信息
export async function decideGpt5Routing(input: string | any[]) {
  return routeGpt5Model(input);
}

// Responses API 调用（支持 gpt-5 系列模型自动路由）
export async function createResponse({
  model,
  input,
  instructions,
  settings,
  tools,
  stream = false,
  decision,
}: {
  model: ModelId;
  input: string | any[];
  instructions?: string;
  settings: ConversationSettings;
  tools?: Tool[];
  stream?: boolean;
  decision?: { model: ModelId; effort: 'minimal' | 'low' | 'medium' | 'high' };
}) {
  let finalModel: ModelId = model;
  let selectedEffort: 'minimal' | 'low' | 'medium' | 'high' | undefined;

  if (model === 'gpt-5') {
    if (decision) {
      finalModel = decision.model;
      selectedEffort = decision.effort;
    } else {
      const d = await routeGpt5Model(input);
      finalModel = d.model;
      selectedEffort = d.effort;
    }
  } else if (model === 'gpt-5-mini' || model === 'gpt-5-nano') {
    selectedEffort = 'high';
  }

  const modelConfig = MODELS[finalModel];

  // 基础参数
  const params: any = {
    model: finalModel,
    input,
    stream,
  };

  // 添加指令
  if (instructions) {
    params.instructions = instructions;
  }

  if (modelConfig.supportsVerbosity && settings.text) {
    params.text = settings.text;
  }

  // 最大输出 Token（推理/Responses API 使用）
  if (settings.maxTokens) {
    params.max_output_tokens = settings.maxTokens;
  }

  // 推理级别（仅 responses 推理模型）
  if (modelConfig.supportsReasoning) {
    params.reasoning = { effort: selectedEffort || 'high' };
  }

  // 添加工具支持
  if (tools && tools.length > 0 && modelConfig.supportsTools) {
    params.tools = tools;
    params.tool_choice = 'auto';
  }

  // 添加网络搜索支持
  if (settings.webSearch && modelConfig.supportsSearch) {
    params.web_search_options = {};
  }

  return await (openai as any).responses.create(params);
}

// 预定义的工具函数
export const PREDEFINED_TOOLS: Tool[] = [
  {
    type: 'function',
    name: 'get_current_weather',
    description: '获取指定地点的当前天气信息',
    parameters: {
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: '城市和州/省，例如：北京, 中国 或 San Francisco, CA',
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: '温度单位',
        },
      },
      required: ['location', 'unit'],
    },
  },
  {
    type: 'function',
    name: 'calculate_math',
    description: '执行数学计算',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: '要计算的数学表达式，例如：2 + 2 * 3',
        },
      },
      required: ['expression'],
    },
  },
  {
    type: 'function',
    name: 'get_current_time',
    description: '获取当前时间',
    parameters: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: '时区，例如：Asia/Shanghai, America/New_York',
        },
      },
      required: [],
    },
  },
];

// 执行工具函数
export async function executeFunction(name: string, args: any): Promise<string> {
  try {
    switch (name) {
      case 'get_current_weather':
        // 模拟天气 API 调用
        const { location, unit } = args;
        const temperature = unit === 'celsius' ? '22°C' : '72°F';
        return `${location} 的当前天气：晴朗，温度 ${temperature}，湿度 60%，风速 5km/h`;

      case 'calculate_math':
        // 安全的数学计算
        const { expression } = args;
        // 简单的数学表达式计算（生产环境中应使用更安全的计算库）
        const result = Function(`"use strict"; return (${expression})`)();
        return `计算结果：${expression} = ${result}`;

      case 'get_current_time':
        // 获取当前时间
        const { timezone = 'Asia/Shanghai' } = args;
        const now = new Date();
        const timeString = now.toLocaleString('zh-CN', { 
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        return `当前时间（${timezone}）：${timeString}`;

      default:
        return `未知函数：${name}`;
    }
  } catch (error) {
    return `执行函数 ${name} 时出错：${error}`;
  }
}

// 处理图像输入
export function formatImageInput(imageUrl: string, text: string) {
  return [
    {
      role: 'user',
      content: [
        { type: 'input_text', text },
        { type: 'input_image', image_url: imageUrl },
      ],
    },
  ];
}

// 验证模型是否支持特定功能
export function validateModelFeature(model: ModelId, feature: string): boolean {
  const modelConfig = MODELS[model];
  switch (feature) {
    case 'vision':
      return modelConfig.supportsVision || false;
    case 'search':
      return modelConfig.supportsSearch || false;
    case 'tools':
      return modelConfig.supportsTools || false;
    case 'reasoning':
      return modelConfig.supportsReasoning || false;
    case 'verbosity':
      return modelConfig.supportsVerbosity || false;
    case 'temperature':
      return modelConfig.supportsTemperature !== false;
    default:
      return false;
  }
}
