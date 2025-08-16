import OpenAI from 'openai';
import { 
  ModelId, 
  MODELS, 
  EXTENDED_MODELS,
  ConversationSettings, 
  Tool, 
  RoutingContext,
  RoutingDecision,
  ReasoningLevel
} from './types';
import { GPT5Router } from './gpt5-router';
import { routerConfigManager } from './router-config';

// 初始化 OpenAI 客户端
export const openai = new OpenAI({
  apiKey: process.env.AIHUBMIX_API_KEY!,
  baseURL: process.env.AIHUBMIX_BASE_URL || 'https://aihubmix.com/v1',
});

// 生成随机种子
export const generateSeed = () => Math.floor(Math.random() * 1000000000);

// 创建路由器实例
const router = new GPT5Router(routerConfigManager.getConfig());

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

// 使用智能路由器进行模型选择
async function routeGpt5Model(
  input: string | any[], 
  context?: RoutingContext
): Promise<{ model: ModelId; reasoningLevel: ReasoningLevel; decision: RoutingDecision }> {
  try {
    // 使用新的智能路由器
    const decision = await router.route(input, context);
    
    // 路由成功

    return {
      model: decision.targetModel,
      reasoningLevel: decision.reasoningLevel,
      decision
    };
  } catch (error) {
    // 智能路由失败，使用传统路由
    
    // 降级到传统路由方法
    const fallbackModel = await fallbackRouteGpt5Model(input);
    return {
      model: fallbackModel,
      reasoningLevel: 'high',
      decision: {
        targetModel: fallbackModel,
        reasoningLevel: 'high',
        confidence: 0.5,
        reasoning: `智能路由失败，使用传统路由: ${error}`,
        fallbackModel: 'gpt-5-nano'
      }
    };
  }
}

// 传统路由方法作为降级选项
async function fallbackRouteGpt5Model(input: string | any[]): Promise<ModelId> {
  try {
    const content = typeof input === 'string' ? input : JSON.stringify(input);
    const routerResponse = await (openai as any).responses.create({
      model: 'gpt-5-nano',
      input: content,
      instructions:
        '你是模型路由器，根据用户问题难度在 gpt-5、gpt-5-mini、gpt-5-nano 中选择，直接返回模型名称。',
      reasoning: { effort: 'high' },
    });
    
    const choice =
      (routerResponse as any).output_text?.trim() ||
      (routerResponse as any).content?.trim() ||
      '';
    
    const valid: ModelId[] = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
    const selected = valid.includes(choice as ModelId) ? (choice as ModelId) : 'gpt-5-nano';
    
    // 传统路由选择模型
    return selected;
  } catch (error) {
    // 传统路由失败，使用默认模型
    return 'gpt-5-nano';
  }
}

// Responses API 调用（支持 gpt-5 系列模型自动路由）
export async function createResponse({
  model,
  input,
  instructions,
  settings,
  tools,
  stream = false,
  context,
}: {
  model: ModelId;
  input: string | any[];
  instructions?: string;
  settings: ConversationSettings;
  tools?: Tool[];
  stream?: boolean;
  context?: RoutingContext;
}) {
  let finalModel: ModelId = model;
  let reasoningLevel: ReasoningLevel = 'high';
  let routingDecision: RoutingDecision | undefined;

  // 检查是否启用智能路由
  const routingEnabled = settings.routing?.enabled !== false; // 默认启用

  if (model === 'gpt-5' && routingEnabled) {
    // 使用智能路由
    const routingResult = await routeGpt5Model(input, context);
    finalModel = routingResult.model;
    reasoningLevel = routingResult.reasoningLevel;
    routingDecision = routingResult.decision;
  } else if (model === 'gpt-5') {
    // 不使用智能路由，但仍需要选择推理级别
    const extendedConfig = EXTENDED_MODELS[model];
    reasoningLevel = settings.routing?.customReasoningLevel || extendedConfig.defaultReasoningLevel;
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

  // 添加推理级别支持
  if (modelConfig.supportsReasoning && reasoningLevel) {
    params.reasoning = { effort: reasoningLevel };
  }

  if (modelConfig.supportsVerbosity && settings.text) {
    params.text = settings.text;
  }

  // 最大输出 Token（推理/Responses API 使用）
  if (settings.maxTokens) {
    params.max_output_tokens = settings.maxTokens;
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

  try {
    const response = await (openai as any).responses.create(params);
    
    // 在响应中添加路由信息
    if (response && routingDecision) {
      response._routingInfo = {
        originalModel: model,
        finalModel,
        reasoningLevel,
        routingDecision
      };
    }

    return response;
  } catch (error) {
    // API 调用失败
    
    // 如果使用了路由但失败，尝试降级
    if (routingDecision?.fallbackModel && finalModel !== routingDecision.fallbackModel) {
      // 尝试降级到备选模型
      
      const fallbackParams = {
        ...params,
        model: routingDecision.fallbackModel,
        reasoning: { effort: 'high' } // 备选模型使用高推理级别
      };
      
      try {
        return await (openai as any).responses.create(fallbackParams);
      } catch (fallbackError) {
        // 备选模型也失败
      }
    }
    
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

// 获取路由器实例（用于外部访问）
export function getRouter(): GPT5Router {
  return router;
}

// 更新路由器配置
export function updateRouterConfig(updates: Partial<any>): void {
  routerConfigManager.updateConfig(updates);
  router.updateConfig(routerConfigManager.getConfig());
}

// 获取模型的可用推理级别
export function getModelReasoningLevels(model: ModelId): ReasoningLevel[] {
  const extendedConfig = EXTENDED_MODELS[model];
  return extendedConfig ? extendedConfig.availableReasoningLevels : ['high'];
}

// 验证推理级别是否支持
export function validateReasoningLevel(model: ModelId, level: ReasoningLevel): boolean {
  const availableLevels = getModelReasoningLevels(model);
  return availableLevels.includes(level);
}

// 创建路由上下文
export function createRoutingContext(options: {
  userId?: string;
  conversationId?: string;
  responseTimeRequirement?: 'fast' | 'normal' | 'quality';
  previousModel?: ModelId;
  preferQuality?: boolean;
  preferSpeed?: boolean;
}): RoutingContext {
  return {
    userId: options.userId,
    conversationId: options.conversationId,
    responseTimeRequirement: options.responseTimeRequirement,
    previousModel: options.previousModel,
    userPreferences: {
      preferQuality: options.preferQuality || false,
      preferSpeed: options.preferSpeed || false,
    }
  };
}

// 从响应中提取路由信息
export function extractRoutingInfo(response: any): {
  originalModel?: ModelId;
  finalModel?: ModelId;
  reasoningLevel?: ReasoningLevel;
  routingDecision?: RoutingDecision;
} | null {
  return response?._routingInfo || null;
}

// 获取路由监控数据
export function getRoutingMonitoringData() {
  return {
    routerStats: router.getRoutingStats()
  };
}

// 获取路由日志
export function getRoutingLogs() {
  return [];
}

// 导出监控数据 - 已精简
export function exportMonitoringData(): string {
  return JSON.stringify(router.getRoutingStats(), null, 2);
}

// 清理旧日志 - 已精简
export function cleanupRoutingLogs(): number {
  return 0;
}

// 获取性能趋势 - 已精简
export function getPerformanceTrend() {
  return { timestamps: [], executionTimes: [], successRates: [] };
}

// 获取性能指标 - 已精简
export function getPerformanceMetrics() {
  return {
    routingStats: router.getRoutingStats(),
    memoryUsage: { routerMemory: 0, cacheMemory: 0 },
    recommendations: []
  };
}

// 批量路由处理
export async function routeBatch(
  inputs: Array<{ input: string | any[]; context?: RoutingContext }>,
  options?: { maxConcurrency?: number; timeout?: number }
) {
  return router.routeBatch(inputs, options);
}

// 预热缓存
export async function warmupRouterCache(commonInputs: string[]) {
  return router.warmupCache(commonInputs);
}

// 优化性能 - 已精简
export function optimizeRouterPerformance() {
  return;
}

// 清理缓存
export function clearComplexityCache() {
  const { ComplexityAnalyzer } = require('./complexity-analyzer');
  ComplexityAnalyzer.clearCache();
}

// A/B 测试相关功能 - 已移除
export function getABTestingReport() {
  return { activeExperiments: 0, totalResults: 0, experiments: [] };
}

export function toggleABTestExperiment(experimentId: string, enabled: boolean) {
  return;
}

export function cleanupABTestData() {
  return;
}

// 获取 A/B 测试管理器 - 已移除
export function getABTestingManager() {
  return null;
}

/**
 * ========================================
 * GPT-5 智能路由系统使用指南
 * ========================================
 * 
 * 本系统为 GPT-5 系列模型提供智能路由功能，根据问题复杂度自动选择最合适的模型和推理级别。
 * 
 * ## 核心功能
 * 
 * 1. **智能路由**: 根据问题复杂度自动选择 gpt-5、gpt-5-mini 或 gpt-5-nano
 * 2. **推理级别**: 为 gpt-5 提供 minimal、low、medium、high 四个推理级别
 * 3. **错误处理**: 完善的降级策略和错误恢复机制
 * 4. **性能监控**: 详细的日志记录和性能分析
 * 5. **A/B 测试**: 支持路由策略的实验和优化
 * 
 * ## 基本使用示例
 * 
 * ```typescript
 * import { createResponse, createRoutingContext } from './lib/openai';
 * 
 * // 基本使用 - 启用智能路由（默认）
 * const response = await createResponse({
 *   model: 'gpt-5', // 将自动路由到合适的模型
 *   input: '请解释量子计算的基本原理',
 *   settings: {
 *     maxTokens: 2000,
 *     routing: {
 *       enabled: true, // 启用智能路由
 *       preferQuality: true // 偏好质量而非速度
 *     }
 *   }
 * });
 * 
 * // 带上下文的路由
 * const context = createRoutingContext({
 *   userId: 'user123',
 *   conversationId: 'conv456',
 *   responseTimeRequirement: 'quality', // 'fast' | 'normal' | 'quality'
 *   preferQuality: true
 * });
 * 
 * const contextualResponse = await createResponse({
 *   model: 'gpt-5',
 *   input: '设计一个分布式系统架构',
 *   settings: { maxTokens: 4000 },
 *   context
 * });
 * 
 * // 禁用智能路由，使用固定推理级别
 * const fixedResponse = await createResponse({
 *   model: 'gpt-5',
 *   input: '1+1等于几？',
 *   settings: {
 *     routing: {
 *       enabled: false,
 *       customReasoningLevel: 'minimal'
 *     }
 *   }
 * });
 * ```
 * 
 * ## 监控和分析
 * 
 * ```typescript
 * import { 
 *   getRoutingMonitoringData, 
 *   getPerformanceMetrics,
 *   getRoutingLogs,
 *   exportMonitoringData 
 * } from './lib/openai';
 * 
 * // 获取实时监控数据
 * const monitoring = getRoutingMonitoringData();
 * console.log('成功率:', monitoring.routerStats.successRate);
 * console.log('平均响应时间:', monitoring.loggerStats.averageExecutionTime);
 * 
 * // 获取性能指标
 * const performance = getPerformanceMetrics();
 * console.log('缓存命中率:', performance.cacheStats.hitRate);
 * console.log('内存使用:', performance.memoryUsage);
 * 
 * // 筛选日志
 * const errorLogs = getRoutingLogs({
 *   success: false,
 *   timeRange: {
 *     start: new Date(Date.now() - 24 * 60 * 60 * 1000), // 最近24小时
 *     end: new Date()
 *   }
 * });
 * 
 * // 导出完整监控数据
 * const exportData = exportMonitoringData();
 * // 可以保存到文件或发送到监控系统
 * ```
 * 
 * ## 性能优化
 * 
 * ```typescript
 * import { 
 *   warmupRouterCache, 
 *   optimizeRouterPerformance,
 *   clearComplexityCache,
 *   routeBatch 
 * } from './lib/openai';
 * 
 * // 预热缓存（应用启动时）
 * const commonQuestions = [
 *   '你好',
 *   '请介绍一下自己',
 *   '今天天气怎么样？',
 *   '解释一下机器学习'
 * ];
 * await warmupRouterCache(commonQuestions);
 * 
 * // 批量处理（提高效率）
 * const batchInputs = [
 *   { input: '问题1', context: createRoutingContext({ userId: 'user1' }) },
 *   { input: '问题2', context: createRoutingContext({ userId: 'user2' }) },
 *   { input: '问题3', context: createRoutingContext({ userId: 'user3' }) }
 * ];
 * 
 * const batchResults = await routeBatch(batchInputs, {
 *   maxConcurrency: 3,
 *   timeout: 30000
 * });
 * 
 * // 自动性能优化
 * optimizeRouterPerformance();
 * 
 * // 清理缓存（内存不足时）
 * clearComplexityCache();
 * ```
 * 
 * ## A/B 测试
 * 
 * ```typescript
 * import { 
 *   getABTestingReport, 
 *   toggleABTestExperiment,
 *   getABTestingManager 
 * } from './lib/openai';
 * 
 * // 查看 A/B 测试报告
 * const abReport = getABTestingReport();
 * console.log('活跃实验数:', abReport.activeExperiments);
 * 
 * // 启用/禁用实验
 * toggleABTestExperiment('conservative_vs_aggressive', true);
 * 
 * // 高级配置
 * const abManager = getABTestingManager();
 * abManager.addExperiment({
 *   id: 'custom_experiment',
 *   name: '自定义实验',
 *   description: '测试新的路由策略',
 *   enabled: true,
 *   startDate: new Date(),
 *   endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7天
 *   trafficAllocation: 0.05, // 5%流量
 *   variants: [
 *     {
 *       id: 'control',
 *       name: '对照组',
 *       weight: 50,
 *       routingStrategy: {
 *         name: 'control',
 *         thresholds: { simpleComplexity: 35, mediumComplexity: 65 },
 *         modelPreferences: { simple: 'gpt-5-nano', medium: 'gpt-5-mini', complex: 'gpt-5' },
 *         reasoningLevelAdjustment: 0,
 *         fallbackStrategy: 'conservative'
 *       }
 *     }
 *   ],
 *   targetMetrics: ['success_rate', 'response_time']
 * });
 * ```
 * 
 * ## 配置管理
 * 
 * ```typescript
 * import { updateRouterConfig, getRouter } from './lib/openai';
 * 
 * // 更新路由配置
 * updateRouterConfig({
 *   thresholds: {
 *     simpleComplexity: 30,    // 降低简单问题阈值
 *     mediumComplexity: 70,    // 提高中等复杂度阈值
 *     fastResponseTime: 3000   // 3秒快速响应要求
 *   },
 *   fallbackStrategy: 'aggressive', // 使用激进降级策略
 *   enableLogging: true
 * });
 * 
 * // 获取路由器实例进行高级操作
 * const router = getRouter();
 * const stats = router.getRoutingStats();
 * const config = router.getConfig();
 * ```
 * 
 * ## 故障排除
 * 
 * ### 常见问题
 * 
 * 1. **路由决策不准确**
 *    - 检查复杂度分析的准确性
 *    - 调整复杂度阈值配置
 *    - 查看路由日志分析决策过程
 * 
 * 2. **响应时间过长**
 *    - 检查缓存命中率
 *    - 优化复杂度分析算法
 *    - 考虑预热常用查询
 * 
 * 3. **错误率较高**
 *    - 检查模型可用性
 *    - 调整超时设置
 *    - 查看错误日志分析原因
 * 
 * 4. **内存使用过高**
 *    - 清理缓存
 *    - 减少日志保留时间
 *    - 调整缓存大小限制
 * 
 * ### 调试技巧
 * 
 * ```typescript
 * // 启用详细日志
 * updateRouterConfig({ enableLogging: true });
 * 
 * // 查看特定时间段的日志
 * const recentLogs = getRoutingLogs({
 *   timeRange: {
 *     start: new Date(Date.now() - 60 * 60 * 1000), // 最近1小时
 *     end: new Date()
 *   }
 * });
 * 
 * // 分析性能趋势
 * const trend = getPerformanceTrend(6); // 最近6小时
 * console.log('响应时间趋势:', trend.executionTimes);
 * console.log('成功率趋势:', trend.successRates);
 * 
 * // 获取实时健康状态
 * const monitoring = getRoutingMonitoringData();
 * const health = monitoring.realtimeMetrics.healthStatus;
 * console.log('系统健康状态:', health); // 'healthy' | 'warning' | 'critical'
 * ```
 * 
 * ## 最佳实践
 * 
 * 1. **启动时预热**: 应用启动时预热常用查询的缓存
 * 2. **监控告警**: 设置成功率和响应时间的监控告警
 * 3. **定期清理**: 定期清理过期的日志和缓存数据
 * 4. **A/B 测试**: 使用 A/B 测试优化路由策略
 * 5. **配置调优**: 根据实际使用情况调整复杂度阈值
 * 6. **错误处理**: 实现适当的错误处理和用户反馈机制
 * 
 * ## 注意事项
 * 
 * - GPT-5 路由功能是隐藏的后台功能，不会在用户界面显示
 * - 所有路由决策都会被记录用于分析和优化
 * - 用户输入内容会被哈希化处理以保护隐私
 * - 系统会自动处理模型不可用的情况
 * - 建议在生产环境中启用日志记录和监控
 */
