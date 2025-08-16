import {
  ModelId,
  ReasoningLevel,
  RoutingDecision,
  ComplexityAnalysis,
  RoutingContext,
  RouterConfig,
  ExtendedModelConfig,
  EXTENDED_MODELS,
  RoutingError
} from './types';
import { ComplexityAnalyzer } from './complexity-analyzer';

// 错误处理策略配置
export interface ErrorHandlingStrategy {
  maxRetries: number;
  timeoutMs: number;
  fallbackChain: ModelId[];
  retryDelayMs: number;
}

// 降级策略配置
export interface FallbackStrategy {
  primary: ModelId;
  secondary: ModelId;
  emergency: ModelId;
  maxRetries: number;
  timeoutMs: number;
}

// 默认错误处理策略
export const DEFAULT_ERROR_STRATEGIES = {
  MODEL_UNAVAILABLE: {
    maxRetries: 2,
    timeoutMs: 30000,
    fallbackChain: ['gpt-5-mini', 'gpt-5-nano'] as ModelId[],
    retryDelayMs: 1000,
  },
  COMPLEXITY_ANALYSIS_FAILED: {
    maxRetries: 1,
    timeoutMs: 10000,
    fallbackChain: ['gpt-5', 'gpt-5-mini'] as ModelId[],
    retryDelayMs: 500,
  },
  ROUTING_TIMEOUT: {
    maxRetries: 0,
    timeoutMs: 5000,
    fallbackChain: ['gpt-5-nano'] as ModelId[],
    retryDelayMs: 0,
  },
};

// 默认降级策略
export const DEFAULT_FALLBACK_STRATEGY: FallbackStrategy = {
  primary: 'gpt-5',
  secondary: 'gpt-5-mini',
  emergency: 'gpt-5-nano',
  maxRetries: 3,
  timeoutMs: 30000,
};

/**
 * GPT-5 智能路由器
 * 根据问题复杂度和上下文智能选择最合适的模型和推理级别
 */
export class GPT5Router {
  private config: RouterConfig;
  private errorStrategies: typeof DEFAULT_ERROR_STRATEGIES;
  private fallbackStrategy: FallbackStrategy;
  private routingStats: {
    totalRoutes: number;
    successfulRoutes: number;
    failedRoutes: number;
    modelUsage: Record<ModelId, number>;
    errorCounts: Record<string, number>;
  };

  constructor(config?: Partial<RouterConfig>) {
    this.config = this.mergeWithDefaultConfig(config || {});
    this.errorStrategies = DEFAULT_ERROR_STRATEGIES;
    this.fallbackStrategy = DEFAULT_FALLBACK_STRATEGY;
    this.routingStats = {
      totalRoutes: 0,
      successfulRoutes: 0,
      failedRoutes: 0,
      modelUsage: {} as Record<ModelId, number>,
      errorCounts: {}
    };
  }

  /**
   * 主要路由方法
   * 分析输入并返回路由决策
   */
  async route(input: string | any[], context?: RoutingContext): Promise<RoutingDecision> {
    const startTime = Date.now();
    this.routingStats.totalRoutes++;
    let complexity: ComplexityAnalysis | undefined;
    let decision: RoutingDecision | undefined;
    let success = false;

    try {
      // 1. 复杂度分析
      complexity = await this.withTimeout(
        ComplexityAnalyzer.analyzeComplexity(input),
        this.errorStrategies.COMPLEXITY_ANALYSIS_FAILED.timeoutMs,
        'COMPLEXITY_ANALYSIS_TIMEOUT'
      );

      // 2. 选择模型
      decision = this.selectModel(complexity, context);

      // 3. 验证模型可用性
      await this.validateModelAvailability(decision.targetModel);

      // 4. 选择推理级别
      decision.reasoningLevel = this.selectReasoningLevel(decision.targetModel, complexity, context);

      // 5. 生成决策理由
      decision.reasoning = this.generateReasoningExplanation(complexity, decision, context);

      // 6. 最终验证
      if (!this.validateDecision(decision)) {
        throw new RoutingError('路由决策验证失败', 'INVALID_DECISION');
      }

      // 记录成功统计
      this.routingStats.successfulRoutes++;
      this.updateModelUsage(decision.targetModel);
      success = true;

      return decision;
    } catch (error) {
      // 记录错误统计
      this.routingStats.failedRoutes++;
      this.recordError(error as Error);

      // 尝试错误恢复
      const fallbackDecision = await this.handleRoutingError(error as Error, input, context);
      return fallbackDecision;
    }
  }

  /**
   * 选择最合适的模型
   */
  private selectModel(complexity: ComplexityAnalysis, context?: RoutingContext): RoutingDecision {
    const { category, score } = complexity;

    // 检查用户偏好
    if (context?.responseTimeRequirement === 'fast') {
      return {
        targetModel: 'gpt-5-nano',
        reasoningLevel: 'high',
        confidence: 0.8,
        reasoning: '用户要求快速响应',
        fallbackModel: 'gpt-5-mini'
      };
    }

    if (context?.userPreferences?.preferSpeed && !context?.userPreferences?.preferQuality) {
      return {
        targetModel: score < 50 ? 'gpt-5-nano' : 'gpt-5-mini',
        reasoningLevel: 'high',
        confidence: 0.7,
        reasoning: '用户偏好速度',
        fallbackModel: 'gpt-5'
      };
    }

    // 基于复杂度选择模型
    switch (category) {
      case 'simple':
        if (score < 25) {
          return {
            targetModel: 'gpt-5-nano',
            reasoningLevel: 'high',
            confidence: 0.9,
            reasoning: '问题简单，使用轻量模型',
            fallbackModel: 'gpt-5-mini'
          };
        } else {
          return {
            targetModel: 'gpt-5',
            reasoningLevel: 'minimal',
            confidence: 0.8,
            reasoning: '简单问题，使用低推理级别',
            fallbackModel: 'gpt-5-nano'
          };
        }

      case 'medium':
        if (complexity.factors.requiresReasoning || complexity.factors.domainSpecific) {
          return {
            targetModel: 'gpt-5',
            reasoningLevel: 'medium',
            confidence: 0.85,
            reasoning: '中等复杂度且需要推理',
            fallbackModel: 'gpt-5-mini'
          };
        } else {
          return {
            targetModel: 'gpt-5-mini',
            reasoningLevel: 'high',
            confidence: 0.8,
            reasoning: '中等复杂度，使用轻量推理模型',
            fallbackModel: 'gpt-5'
          };
        }

      case 'complex':
        const reasoningLevel = this.selectGpt5ReasoningLevel(complexity);
        return {
          targetModel: 'gpt-5',
          reasoningLevel,
          confidence: 0.9,
          reasoning: '复杂问题，需要深度推理',
          fallbackModel: 'gpt-5-mini'
        };

      default:
        return {
          targetModel: 'gpt-5',
          reasoningLevel: 'medium',
          confidence: 0.6,
          reasoning: '默认选择',
          fallbackModel: 'gpt-5-mini'
        };
    }
  }

  /**
   * 为 GPT-5 选择推理级别
   */
  private selectGpt5ReasoningLevel(complexity: ComplexityAnalysis): ReasoningLevel {
    const { score, factors } = complexity;

    // 高复杂度因素计数
    let highComplexityFactors = 0;

    if (factors.domainSpecific) highComplexityFactors++;
    if (factors.multiStep) highComplexityFactors++;
    if (factors.requiresReasoning) highComplexityFactors++;
    if (factors.questionType === 'technical' || factors.questionType === 'creative') highComplexityFactors++;

    // 根据复杂度分数和因素选择推理级别
    if (score >= 80 || highComplexityFactors >= 3) {
      return 'high';
    } else if (score >= 60 || highComplexityFactors >= 2) {
      return 'medium';
    } else if (score >= 40 || highComplexityFactors >= 1) {
      return 'low';
    } else {
      return 'minimal';
    }
  }

  /**
   * 选择推理级别
   */
  private selectReasoningLevel(
    model: ModelId,
    complexity: ComplexityAnalysis,
    context?: RoutingContext
  ): ReasoningLevel {
    const modelConfig = EXTENDED_MODELS[model];

    // 检查用户自定义推理级别
    if (context?.userPreferences && 'customReasoningLevel' in context.userPreferences) {
      const customLevel = (context.userPreferences as any).customReasoningLevel;
      if (modelConfig.availableReasoningLevels.indexOf(customLevel) !== -1) {
        return customLevel;
      }
    }

    // 对于只支持 high 级别的模型，直接返回 high
    if (modelConfig.availableReasoningLevels.length === 1) {
      return modelConfig.availableReasoningLevels[0];
    }

    // 对于 GPT-5，根据复杂度选择推理级别
    if (model === 'gpt-5') {
      return this.selectGpt5ReasoningLevel(complexity);
    }

    // 默认返回模型的默认推理级别
    return modelConfig.defaultReasoningLevel;
  }

  /**
   * 生成决策理由说明
   */
  private generateReasoningExplanation(
    complexity: ComplexityAnalysis,
    decision: RoutingDecision,
    context?: RoutingContext
  ): string {
    const parts = [];

    // 复杂度信息
    parts.push(`复杂度: ${complexity.category} (${complexity.score}/100)`);

    // 模型选择理由
    parts.push(`选择 ${decision.targetModel}`);

    // 推理级别理由
    if (decision.targetModel === 'gpt-5') {
      parts.push(`推理级别: ${decision.reasoningLevel}`);
    }

    // 关键因素
    const factors = [];
    if (complexity.factors.domainSpecific) factors.push('专业领域');
    if (complexity.factors.multiStep) factors.push('多步骤');
    if (complexity.factors.requiresReasoning) factors.push('需要推理');

    if (factors.length > 0) {
      parts.push(`关键因素: ${factors.join(', ')}`);
    }

    // 用户偏好
    if (context?.responseTimeRequirement === 'fast') {
      parts.push('优先速度');
    } else if (context?.userPreferences?.preferQuality) {
      parts.push('优先质量');
    }

    return parts.join(' | ');
  }

  /**
   * 验证路由决策的有效性
   */
  validateDecision(decision: RoutingDecision): boolean {
    const modelConfig = EXTENDED_MODELS[decision.targetModel];

    if (!modelConfig) {
      return false;
    }

    if (modelConfig.availableReasoningLevels.indexOf(decision.reasoningLevel) === -1) {
      return false;
    }

    if (decision.confidence < 0 || decision.confidence > 1) {
      return false;
    }

    return true;
  }

  /**
   * 获取路由统计信息
   */
  getRoutingStats(): {
    totalRoutes: number;
    successfulRoutes: number;
    failedRoutes: number;
    modelDistribution: Record<ModelId, number>;
    successRate: number;
    errorStats: {
      totalErrors: number;
      errorBreakdown: Record<string, number>;
      mostCommonError: string | null;
    };
  } {
    const errorStats = this.getErrorStats();

    return {
      totalRoutes: this.routingStats.totalRoutes,
      successfulRoutes: this.routingStats.successfulRoutes,
      failedRoutes: this.routingStats.failedRoutes,
      modelDistribution: { ...this.routingStats.modelUsage },
      successRate: errorStats.successRate,
      errorStats: {
        totalErrors: errorStats.totalErrors,
        errorBreakdown: errorStats.errorBreakdown,
        mostCommonError: errorStats.mostCommonError
      }
    };
  }

  /**
   * 更新路由配置
   */
  updateConfig(updates: Partial<RouterConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * 获取当前配置
   */
  getConfig(): RouterConfig {
    return { ...this.config };
  }

  /**
   * 处理路由错误
   */
  private async handleRoutingError(
    error: Error,
    input: string | any[],
    context?: RoutingContext
  ): Promise<RoutingDecision> {
    const errorType = this.classifyError(error);
    const strategy = this.errorStrategies[errorType] || this.errorStrategies.MODEL_UNAVAILABLE;

    // 尝试降级策略
    for (const fallbackModel of strategy.fallbackChain) {
      try {
        await this.validateModelAvailability(fallbackModel);

        const fallbackDecision: RoutingDecision = {
          targetModel: fallbackModel,
          reasoningLevel: EXTENDED_MODELS[fallbackModel].defaultReasoningLevel,
          confidence: 0.3,
          reasoning: `错误恢复: ${errorType} -> 降级到 ${fallbackModel}`,
          fallbackModel: this.getNextFallback(fallbackModel)
        };

        return fallbackDecision;
      } catch (fallbackError) {
        continue;
      }
    }

    // 所有降级都失败，返回紧急降级
    return this.getEmergencyFallback(error);
  }

  /**
   * 分类错误类型
   */
  private classifyError(error: Error): keyof typeof DEFAULT_ERROR_STRATEGIES {
    if (error instanceof RoutingError) {
      switch (error.code) {
        case 'MODEL_UNAVAILABLE':
        case 'API_ERROR':
          return 'MODEL_UNAVAILABLE';
        case 'COMPLEXITY_ANALYSIS_FAILED':
          return 'COMPLEXITY_ANALYSIS_FAILED';
        case 'TIMEOUT':
        case 'COMPLEXITY_ANALYSIS_TIMEOUT':
          return 'ROUTING_TIMEOUT';
        default:
          return 'MODEL_UNAVAILABLE';
      }
    }

    if (error.message.includes('timeout') || error.message.includes('超时')) {
      return 'ROUTING_TIMEOUT';
    }

    if (error.message.includes('complexity') || error.message.includes('复杂度')) {
      return 'COMPLEXITY_ANALYSIS_FAILED';
    }

    return 'MODEL_UNAVAILABLE';
  }

  /**
   * 验证模型可用性
   */
  private async validateModelAvailability(model: ModelId): Promise<void> {
    if (!this.config.models[model]) {
      throw new RoutingError(`模型 ${model} 未在配置中`, 'MODEL_NOT_CONFIGURED', this.getNextFallback(model));
    }

    const modelConfig = this.config.models[model];
    if (!modelConfig.name || !modelConfig.type) {
      throw new RoutingError(`模型 ${model} 配置无效`, 'INVALID_MODEL_CONFIG', this.getNextFallback(model));
    }
  }

  /**
   * 获取下一个降级模型
   */
  private getNextFallback(currentModel: ModelId): ModelId | undefined {
    const fallbackChain: ModelId[] = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano'];
    const currentIndex = fallbackChain.indexOf(currentModel);

    if (currentIndex >= 0 && currentIndex < fallbackChain.length - 1) {
      return fallbackChain[currentIndex + 1];
    }

    return undefined;
  }

  /**
   * 获取紧急降级决策
   */
  private getEmergencyFallback(error: Error): RoutingDecision {
    return {
      targetModel: this.fallbackStrategy.emergency,
      reasoningLevel: 'high',
      confidence: 0.1,
      reasoning: `紧急降级: 所有策略失败 - ${error.message}`,
      fallbackModel: undefined
    };
  }

  /**
   * 带超时的 Promise 包装器
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorCode: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new RoutingError(`操作超时 (${timeoutMs}ms)`, errorCode));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * 记录错误统计
   */
  private recordError(error: Error): void {
    const errorType = error instanceof RoutingError ? error.code : 'UNKNOWN_ERROR';
    this.routingStats.errorCounts[errorType] = (this.routingStats.errorCounts[errorType] || 0) + 1;
  }

  /**
   * 更新模型使用统计
   */
  private updateModelUsage(model: ModelId): void {
    this.routingStats.modelUsage[model] = (this.routingStats.modelUsage[model] || 0) + 1;
  }

  /**
   * 获取错误处理统计
   */
  getErrorStats(): {
    totalErrors: number;
    errorBreakdown: Record<string, number>;
    successRate: number;
    mostCommonError: string | null;
  } {
    const errorCounts = this.routingStats.errorCounts;
    const totalErrors = Object.keys(errorCounts).reduce((sum: number, key: string) => sum + errorCounts[key], 0);
    const successRate = this.routingStats.totalRoutes > 0
      ? this.routingStats.successfulRoutes / this.routingStats.totalRoutes
      : 0;

    const errorEntries = Object.keys(this.routingStats.errorCounts).map(key => [key, this.routingStats.errorCounts[key]]);
    const mostCommonError = errorEntries.length > 0
      ? errorEntries.sort((a: any, b: any) => b[1] - a[1])[0][0]
      : null;

    return {
      totalErrors,
      errorBreakdown: { ...this.routingStats.errorCounts },
      successRate,
      mostCommonError
    };
  }

  /**
   * 合并默认配置
   */
  private mergeWithDefaultConfig(config: Partial<RouterConfig>): RouterConfig {
    const defaultConfig: RouterConfig = {
      models: EXTENDED_MODELS,
      thresholds: {
        simpleComplexity: 30,
        mediumComplexity: 60,
        fastResponseTime: 500,
        qualityThreshold: 0.8
      },
      fallbackStrategy: 'conservative',
      enableLogging: false
    };

    return { ...defaultConfig, ...config };
  }

  /**
   * 重置统计数据
   */
  resetStats(): void {
    this.routingStats = {
      totalRoutes: 0,
      successfulRoutes: 0,
      failedRoutes: 0,
      modelUsage: {} as Record<ModelId, number>,
      errorCounts: {}
    };
  }
}

// 创建全局路由器实例
export const router = new GPT5Router();