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

// Responses API 调用
export async function createResponse({
  model,
  input,
  instructions,
  settings,
  tools,
  stream = false,
}: {
  model: ModelId;
  input: string | any[];
  instructions?: string;
  settings: ConversationSettings;
  tools?: Tool[];
  stream?: boolean;
}) {
  const modelConfig = MODELS[model];

  console.log('🚀 [GPT-5 Debug] 开始创建 Responses API 请求');
  console.log('📋 [GPT-5 Debug] 请求参数:', {
    model,
    inputType: typeof input,
    inputLength: typeof input === 'string' ? input.length : Array.isArray(input) ? input.length : 0,
    hasInstructions: !!instructions,
    settings,
    toolsCount: tools?.length || 0,
    stream,
    modelConfig
  });

  // 基础参数
  const params: any = {
    model,
    input,
    stream,
  };

  // 添加指令
  if (instructions) {
    params.instructions = instructions;
    console.log('📝 [GPT-5 Debug] 添加指令:', instructions.substring(0, 100) + (instructions.length > 100 ? '...' : ''));
  }

  // GPT-5 系列特有参数
  if (modelConfig.supportsReasoning && settings.reasoning) {
    params.reasoning = settings.reasoning;
    console.log('🧠 [GPT-5 Debug] 启用推理模式:', settings.reasoning);
  }

  if (modelConfig.supportsVerbosity && settings.text) {
    params.text = settings.text;
    console.log('💬 [GPT-5 Debug] 设置文本详细度:', settings.text);
  }

  // 最大输出 Token（推理/Responses API 使用）
  if (settings.maxTokens) {
    params.max_output_tokens = settings.maxTokens;
    console.log('🔢 [GPT-5 Debug] 设置最大输出 Token:', settings.maxTokens);
  }

  // 添加工具支持
  if (tools && tools.length > 0 && modelConfig.supportsTools) {
    params.tools = tools;
    params.tool_choice = 'auto';
    console.log('🔧 [GPT-5 Debug] 启用工具支持，工具数量:', tools.length);
    console.log('🔧 [GPT-5 Debug] 工具列表:', tools.map(t => t.function.name));
  }

  // 添加网络搜索支持
  if (settings.webSearch && modelConfig.supportsSearch) {
    params.web_search_options = {};
    console.log('🌐 [GPT-5 Debug] 启用网络搜索');
  }

  console.log('📤 [GPT-5 Debug] 最终请求参数:', JSON.stringify(params, null, 2));

  try {
    console.log('⏳ [GPT-5 Debug] 发送请求到 OpenAI Responses API...');
    const startTime = Date.now();

    const response = await (openai as any).responses.create(params);

    const endTime = Date.now();
    console.log('✅ [GPT-5 Debug] API 请求成功，耗时:', endTime - startTime, 'ms');
    console.log('📥 [GPT-5 Debug] 响应类型:', typeof response);
    console.log('📥 [GPT-5 Debug] 响应对象键:', Object.keys(response || {}));

    if (stream) {
      console.log('🌊 [GPT-5 Debug] 返回流式响应');
    } else {
      console.log('📄 [GPT-5 Debug] 返回非流式响应');
      console.log('📄 [GPT-5 Debug] 响应内容预览:', JSON.stringify(response, null, 2).substring(0, 500) + '...');
    }

    return response;
  } catch (error) {
    console.error('❌ [GPT-5 Debug] API 请求失败:', error);
    const errInfo = error instanceof Error ? {
      name: error.name,
      message: error.message,
      status: (error as any).status,
      code: (error as any).code,
      type: (error as any).type,
      stack: error.stack
    } : {
      name: 'Unknown',
      message: String(error),
      status: undefined,
      code: undefined,
      type: undefined,
      stack: undefined
    };
    console.error('❌ [GPT-5 Debug] 错误详情:', errInfo);
    throw error;
  }
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
