import { RouterConfig, ModelId, ReasoningLevel, EXTENDED_MODELS } from './types';

/**
 * 路由器配置管理器
 * 负责加载、验证和管理路由器配置
 */
export class RouterConfigManager {
  private static instance: RouterConfigManager;
  private config: RouterConfig;
  private configListeners: Array<(config: RouterConfig) => void> = [];

  private constructor() {
    this.config = this.getDefaultConfig();
  }

  /**
   * 获取单例实例
   */
  static getInstance(): RouterConfigManager {
    if (!RouterConfigManager.instance) {
      RouterConfigManager.instance = new RouterConfigManager();
    }
    return RouterConfigManager.instance;
  }

  /**
   * 加载配置
   */
  loadConfig(): RouterConfig {
    try {
      // 在实际应用中，这里可以从文件、数据库或环境变量加载配置
      // 目前返回默认配置
      return this.config;
    } catch (error) {
      // 加载配置失败，使用默认配置
      return this.getDefaultConfig();
    }
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<RouterConfig>): void {
    const newConfig = this.mergeConfig(this.config, updates);
    
    if (!this.validateConfig(newConfig)) {
      throw new Error('配置验证失败');
    }

    this.config = newConfig;
    this.notifyConfigChange(this.config);
  }

  /**
   * 验证配置
   */
  validateConfig(config: RouterConfig): boolean {
    try {
      // 验证基本结构
      if (!config || typeof config !== 'object') {
        // 配置必须是对象
        return false;
      }

      // 验证模型配置
      if (!config.models || typeof config.models !== 'object') {
        // models 配置无效
        return false;
      }

      // 验证每个模型配置
      for (const [modelId, modelConfig] of Object.entries(config.models)) {
        if (!this.validateModelConfig(modelId as ModelId, modelConfig)) {
          return false;
        }
      }

      // 验证阈值配置
      if (!this.validateThresholds(config.thresholds)) {
        return false;
      }

      // 验证降级策略
      if (!['conservative', 'aggressive'].includes(config.fallbackStrategy)) {
        // fallbackStrategy 必须是 conservative 或 aggressive
        return false;
      }

      // 验证日志配置
      if (typeof config.enableLogging !== 'boolean') {
        // enableLogging 必须是布尔值
        return false;
      }

      return true;
    } catch (error) {
      // 配置验证出错
      return false;
    }
  }

  /**
   * 验证单个模型配置
   */
  private validateModelConfig(modelId: ModelId, modelConfig: any): boolean {
    // 检查必需字段
    const requiredFields = [
      'name', 'description', 'type', 'maxTokens', 
      'availableReasoningLevels', 'defaultReasoningLevel', 'routingPriority'
    ];

    for (const field of requiredFields) {
      if (!(field in modelConfig)) {
        // 模型缺少必需字段
        return false;
      }
    }

    // 验证推理级别
    const validReasoningLevels: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high'];
    
    if (!Array.isArray(modelConfig.availableReasoningLevels)) {
      // 模型的 availableReasoningLevels 必须是数组
      return false;
    }

    for (const level of modelConfig.availableReasoningLevels) {
      if (!validReasoningLevels.includes(level)) {
        // 模型包含无效的推理级别
        return false;
      }
    }

    if (!modelConfig.availableReasoningLevels.includes(modelConfig.defaultReasoningLevel)) {
      // 模型的默认推理级别不在可用级别中
      return false;
    }

    // 验证路由优先级
    if (typeof modelConfig.routingPriority !== 'number' || modelConfig.routingPriority < 1) {
      // 模型的 routingPriority 必须是正整数
      return false;
    }

    // 验证类型
    if (!['chat', 'responses'].includes(modelConfig.type)) {
      // 模型的 type 必须是 chat 或 responses
      return false;
    }

    return true;
  }

  /**
   * 验证阈值配置
   */
  private validateThresholds(thresholds: any): boolean {
    if (!thresholds || typeof thresholds !== 'object') {
      // thresholds 配置无效
      return false;
    }

    const requiredThresholds = ['simpleComplexity', 'mediumComplexity', 'fastResponseTime'];
    
    for (const threshold of requiredThresholds) {
      if (typeof thresholds[threshold] !== 'number') {
        // 阈值必须是数字
        return false;
      }
    }

    // 验证复杂度阈值的逻辑关系
    if (thresholds.simpleComplexity >= thresholds.mediumComplexity) {
      // simpleComplexity 必须小于 mediumComplexity
      return false;
    }

    if (thresholds.simpleComplexity < 0 || thresholds.mediumComplexity > 100) {
      // 复杂度阈值必须在 0-100 范围内
      return false;
    }

    if (thresholds.fastResponseTime <= 0) {
      // fastResponseTime 必须大于 0
      return false;
    }

    return true;
  }

  /**
   * 获取当前配置
   */
  getConfig(): RouterConfig {
    return { ...this.config };
  }

  /**
   * 重置为默认配置
   */
  resetToDefault(): void {
    this.config = this.getDefaultConfig();
    this.notifyConfigChange(this.config);
  }

  /**
   * 添加配置变更监听器
   */
  addConfigListener(listener: (config: RouterConfig) => void): void {
    this.configListeners.push(listener);
  }

  /**
   * 移除配置变更监听器
   */
  removeConfigListener(listener: (config: RouterConfig) => void): void {
    const index = this.configListeners.indexOf(listener);
    if (index > -1) {
      this.configListeners.splice(index, 1);
    }
  }

  /**
   * 通知配置变更
   */
  private notifyConfigChange(config: RouterConfig): void {
    this.configListeners.forEach(listener => {
      try {
        listener(config);
      } catch (error) {
        // 配置监听器执行失败
      }
    });
  }

  /**
   * 获取默认配置
   */
  private getDefaultConfig(): RouterConfig {
    return {
      models: EXTENDED_MODELS,
      thresholds: {
        simpleComplexity: 35,    // 简单问题阈值
        mediumComplexity: 65,    // 中等复杂度阈值
        fastResponseTime: 5000   // 快速响应时间要求 (5秒)
      },
      fallbackStrategy: 'conservative', // 保守的降级策略
      enableLogging: true
    };
  }

  /**
   * 深度合并配置
   */
  private mergeConfig(base: RouterConfig, updates: Partial<RouterConfig>): RouterConfig {
    const merged = { ...base };

    if (updates.models) {
      merged.models = { ...base.models, ...updates.models };
    }

    if (updates.thresholds) {
      merged.thresholds = { ...base.thresholds, ...updates.thresholds };
    }

    if (updates.fallbackStrategy !== undefined) {
      merged.fallbackStrategy = updates.fallbackStrategy;
    }

    if (updates.enableLogging !== undefined) {
      merged.enableLogging = updates.enableLogging;
    }

    return merged;
  }

  /**
   * 导出配置为 JSON
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 从 JSON 导入配置
   */
  importConfig(configJson: string): void {
    try {
      const config = JSON.parse(configJson);
      this.updateConfig(config);
    } catch (error) {
      throw new Error(`配置导入失败: ${error}`);
    }
  }

  /**
   * 获取配置摘要
   */
  getConfigSummary(): {
    modelCount: number;
    enabledModels: ModelId[];
    thresholds: RouterConfig['thresholds'];
    fallbackStrategy: string;
    loggingEnabled: boolean;
  } {
    const enabledModels = Object.keys(this.config.models) as ModelId[];
    
    return {
      modelCount: enabledModels.length,
      enabledModels,
      thresholds: this.config.thresholds,
      fallbackStrategy: this.config.fallbackStrategy,
      loggingEnabled: this.config.enableLogging
    };
  }

  /**
   * 验证模型是否可用
   */
  isModelAvailable(modelId: ModelId): boolean {
    return modelId in this.config.models;
  }

  /**
   * 获取模型的推理级别选项
   */
  getModelReasoningLevels(modelId: ModelId): ReasoningLevel[] {
    const modelConfig = this.config.models[modelId];
    return modelConfig ? modelConfig.availableReasoningLevels : [];
  }

  /**
   * 获取按优先级排序的模型列表
   */
  getModelsByPriority(): ModelId[] {
    return Object.entries(this.config.models)
      .sort(([, a], [, b]) => a.routingPriority - b.routingPriority)
      .map(([modelId]) => modelId as ModelId);
  }
}

// 导出单例实例
export const routerConfigManager = RouterConfigManager.getInstance();

/**
 * ========================================
 * 路由器配置管理示例
 * ========================================
 * 
 * ## 基本配置
 * 
 * ```typescript
 * import { routerConfigManager } from './router-config';
 * 
 * // 获取当前配置
 * const currentConfig = routerConfigManager.getConfig();
 * 
 * // 更新配置
 * routerConfigManager.updateConfig({
 *   thresholds: {
 *     simpleComplexity: 30,    // 简单问题阈值 (0-100)
 *     mediumComplexity: 70,    // 中等复杂度阈值 (0-100)
 *     fastResponseTime: 2000   // 快速响应时间要求 (毫秒)
 *   },
 *   fallbackStrategy: 'conservative', // 'conservative' | 'aggressive'
 *   enableLogging: true
 * });
 * 
 * // 验证配置
 * const isValid = routerConfigManager.validateConfig(newConfig);
 * 
 * // 重置为默认配置
 * routerConfigManager.resetToDefault();
 * ```
 * 
 * ## 高级配置
 * 
 * ```typescript
 * // 自定义模型配置
 * routerConfigManager.updateConfig({
 *   models: {
 *     'gpt-5': {
 *       ...EXTENDED_MODELS['gpt-5'],
 *       availableReasoningLevels: ['low', 'medium', 'high'], // 移除 minimal
 *       defaultReasoningLevel: 'medium',
 *       routingPriority: 1
 *     }
 *   }
 * });
 * 
 * // 配置监听器
 * routerConfigManager.addConfigListener((config) => {
 *   console.log('配置已更新:', config);
 *   // 可以在这里触发其他系统的更新
 * });
 * 
 * // 导出配置
 * const configJson = routerConfigManager.exportConfig();
 * 
 * // 导入配置
 * routerConfigManager.importConfig(configJson);
 * 
 * // 获取配置摘要
 * const summary = routerConfigManager.getConfigSummary();
 * console.log('启用的模型:', summary.enabledModels);
 * console.log('降级策略:', summary.fallbackStrategy);
 * ```
 * 
 * ## 生产环境配置建议
 * 
 * ```typescript
 * // 生产环境推荐配置
 * const productionConfig = {
 *   thresholds: {
 *     simpleComplexity: 35,    // 适中的简单问题阈值
 *     mediumComplexity: 65,    // 适中的复杂度阈值
 *     fastResponseTime: 5000   // 5秒快速响应
 *   },
 *   fallbackStrategy: 'conservative', // 保守策略更稳定
 *   enableLogging: true,       // 生产环境必须启用日志
 *   models: {
 *     // 可以根据实际需要调整模型配置
 *     'gpt-5': {
 *       ...EXTENDED_MODELS['gpt-5'],
 *       routingPriority: 1 // 最高优先级
 *     },
 *     'gpt-5-mini': {
 *       ...EXTENDED_MODELS['gpt-5-mini'],
 *       routingPriority: 2 // 中等优先级
 *     },
 *     'gpt-5-nano': {
 *       ...EXTENDED_MODELS['gpt-5-nano'],
 *       routingPriority: 3 // 最低优先级，用于降级
 *     }
 *   }
 * };
 * 
 * routerConfigManager.updateConfig(productionConfig);
 * ```
 */