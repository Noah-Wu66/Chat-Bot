import { ComplexityAnalysis } from './types';

/**
 * 复杂度分析器
 * 分析用户输入的复杂度，用于智能路由决策
 */
export class ComplexityAnalyzer {
  // 缓存配置
  private static readonly CACHE_SIZE = 1000;
  private static readonly CACHE_TTL = 5 * 60 * 1000; // 5分钟
  
  // 分析结果缓存
  private static cache = new Map<string, { 
    result: ComplexityAnalysis; 
    timestamp: number; 
    hitCount: number;
  }>();
  // 问题类型关键词映射
  private static readonly QUESTION_TYPE_KEYWORDS = {
    factual: ['什么是', '谁是', '哪里', '什么时候', '多少', '定义', '解释', 'what is', 'who is', 'where', 'when', 'how many'],
    analytical: ['分析', '比较', '评估', '为什么', '如何', '原因', '影响', 'analyze', 'compare', 'evaluate', 'why', 'how', 'impact'],
    creative: ['创作', '设计', '想象', '创新', '写', '编写', '创建', 'create', 'design', 'imagine', 'write', 'generate'],
    technical: ['代码', '编程', '算法', '架构', '实现', '开发', '技术', 'code', 'programming', 'algorithm', 'architecture', 'implement']
  };

  // 复杂度指示词
  private static readonly COMPLEXITY_INDICATORS = {
    high: ['复杂', '详细', '深入', '全面', '系统', '架构', '策略', 'complex', 'detailed', 'comprehensive', 'system', 'strategy'],
    medium: ['解释', '说明', '描述', '介绍', 'explain', 'describe', 'introduce'],
    low: ['简单', '快速', '简要', '概括', 'simple', 'quick', 'brief', 'summary']
  };

  // 领域特定关键词
  private static readonly DOMAIN_SPECIFIC_KEYWORDS = [
    '机器学习', '人工智能', '区块链', '量子计算', '生物技术', '金融', '医学', '法律',
    'machine learning', 'artificial intelligence', 'blockchain', 'quantum', 'biotech', 'finance', 'medical', 'legal'
  ];

  /**
   * 分析输入内容的复杂度
   */
  static async analyzeComplexity(input: string | any[]): Promise<ComplexityAnalysis> {
    const content = typeof input === 'string' ? input : JSON.stringify(input);
    
    // 生成缓存键
    const cacheKey = this.generateCacheKey(content);
    
    // 检查缓存
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return cached;
    }
    
    // 执行分析
    const startTime = Date.now();
    
    // 分析各个因素
    const textLength = this.analyzeTextLength(content);
    const questionType = this.analyzeQuestionType(content);
    const domainSpecific = this.analyzeDomainSpecific(content);
    const multiStep = this.analyzeMultiStep(content);
    const requiresReasoning = this.analyzeReasoningRequirement(content);

    // 计算复杂度分数
    const score = this.calculateComplexityScore({
      textLength,
      questionType,
      domainSpecific,
      multiStep,
      requiresReasoning
    });

    // 确定复杂度类别
    const category = this.categorizeComplexity(score);

    const result: ComplexityAnalysis = {
      score,
      factors: {
        textLength,
        questionType,
        domainSpecific,
        multiStep,
        requiresReasoning
      },
      category
    };

    // 缓存结果
    this.setCache(cacheKey, result);
    
    // 记录性能
    const analysisTime = Date.now() - startTime;
    if (analysisTime > 50) { // 如果分析时间超过50ms，记录警告
      console.warn(`复杂度分析耗时较长: ${analysisTime}ms`);
    }

    return result;
  }

  /**
   * 分析文本长度
   */
  private static analyzeTextLength(content: string): number {
    const length = content.length;
    
    if (length < 50) return 10;      // 很短
    if (length < 150) return 30;     // 短
    if (length < 300) return 50;     // 中等
    if (length < 500) return 70;     // 长
    return 90;                       // 很长
  }

  /**
   * 分析问题类型
   */
  private static analyzeQuestionType(content: string): 'factual' | 'analytical' | 'creative' | 'technical' {
    const lowerContent = content.toLowerCase();
    
    // 计算每种类型的匹配分数
    const scores = {
      factual: this.countKeywordMatches(lowerContent, this.QUESTION_TYPE_KEYWORDS.factual),
      analytical: this.countKeywordMatches(lowerContent, this.QUESTION_TYPE_KEYWORDS.analytical),
      creative: this.countKeywordMatches(lowerContent, this.QUESTION_TYPE_KEYWORDS.creative),
      technical: this.countKeywordMatches(lowerContent, this.QUESTION_TYPE_KEYWORDS.technical)
    };

    // 返回得分最高的类型
    return Object.entries(scores).reduce((a, b) => scores[a[0]] > scores[b[0]] ? a : b)[0] as any;
  }

  /**
   * 分析是否为领域特定问题
   */
  private static analyzeDomainSpecific(content: string): boolean {
    const lowerContent = content.toLowerCase();
    return this.DOMAIN_SPECIFIC_KEYWORDS.some(keyword => 
      lowerContent.includes(keyword.toLowerCase())
    );
  }

  /**
   * 分析是否为多步骤问题
   */
  private static analyzeMultiStep(content: string): boolean {
    const multiStepIndicators = [
      '步骤', '首先', '然后', '接下来', '最后', '第一', '第二', '第三',
      'step', 'first', 'then', 'next', 'finally', 'firstly', 'secondly'
    ];
    
    const lowerContent = content.toLowerCase();
    const stepCount = multiStepIndicators.filter(indicator => 
      lowerContent.includes(indicator.toLowerCase())
    ).length;

    // 或者检查是否包含多个问号或句号
    const sentenceCount = (content.match(/[.?!]/g) || []).length;
    
    return stepCount >= 2 || sentenceCount >= 3;
  }

  /**
   * 分析是否需要推理
   */
  private static analyzeReasoningRequirement(content: string): boolean {
    const reasoningIndicators = [
      '为什么', '如何', '原因', '分析', '推理', '逻辑', '因果', '推断',
      'why', 'how', 'reason', 'analyze', 'logic', 'cause', 'infer', 'deduce'
    ];
    
    const lowerContent = content.toLowerCase();
    return reasoningIndicators.some(indicator => 
      lowerContent.includes(indicator.toLowerCase())
    );
  }

  /**
   * 计算复杂度分数
   */
  private static calculateComplexityScore(factors: {
    textLength: number;
    questionType: 'factual' | 'analytical' | 'creative' | 'technical';
    domainSpecific: boolean;
    multiStep: boolean;
    requiresReasoning: boolean;
  }): number {
    let score = 0;

    // 文本长度权重 20%
    score += factors.textLength * 0.2;

    // 问题类型权重 30%
    const questionTypeScores = {
      factual: 20,
      analytical: 60,
      creative: 70,
      technical: 80
    };
    score += questionTypeScores[factors.questionType] * 0.3;

    // 领域特定性权重 15%
    if (factors.domainSpecific) {
      score += 60 * 0.15;
    }

    // 多步骤权重 20%
    if (factors.multiStep) {
      score += 70 * 0.2;
    }

    // 推理需求权重 15%
    if (factors.requiresReasoning) {
      score += 80 * 0.15;
    }

    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * 根据分数确定复杂度类别
   */
  private static categorizeComplexity(score: number): 'simple' | 'medium' | 'complex' {
    if (score < 35) return 'simple';
    if (score < 65) return 'medium';
    return 'complex';
  }

  /**
   * 计算关键词匹配数量
   */
  private static countKeywordMatches(content: string, keywords: string[]): number {
    return keywords.filter(keyword => content.includes(keyword.toLowerCase())).length;
  }

  /**
   * 生成缓存键
   */
  private static generateCacheKey(content: string): string {
    // 使用简单的哈希算法生成缓存键
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return `complexity_${Math.abs(hash)}_${content.length}`;
  }

  /**
   * 从缓存获取结果
   */
  private static getFromCache(key: string): ComplexityAnalysis | null {
    const cached = this.cache.get(key);
    
    if (!cached) {
      return null;
    }
    
    // 检查是否过期
    const now = Date.now();
    if (now - cached.timestamp > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }
    
    // 增加命中次数
    cached.hitCount++;
    
    return cached.result;
  }

  /**
   * 设置缓存
   */
  private static setCache(key: string, result: ComplexityAnalysis): void {
    // 检查缓存大小，如果超过限制则清理
    if (this.cache.size >= this.CACHE_SIZE) {
      this.cleanupCache();
    }
    
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      hitCount: 0
    });
  }

  /**
   * 清理缓存
   */
  private static cleanupCache(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    
    // 删除过期的条目
    const expiredKeys = entries
      .filter(([, value]) => now - value.timestamp > this.CACHE_TTL)
      .map(([key]) => key);
    
    expiredKeys.forEach(key => this.cache.delete(key));
    
    // 如果还是太多，删除最少使用的条目
    if (this.cache.size >= this.CACHE_SIZE) {
      const sortedEntries = entries
        .filter(([key]) => !expiredKeys.includes(key))
        .sort(([, a], [, b]) => a.hitCount - b.hitCount);
      
      const toDelete = sortedEntries.slice(0, Math.floor(this.CACHE_SIZE * 0.2));
      toDelete.forEach(([key]) => this.cache.delete(key));
    }
  }

  /**
   * 获取缓存统计
   */
  static getCacheStats(): {
    size: number;
    maxSize: number;
    hitRate: number;
    totalHits: number;
    oldestEntry: number;
  } {
    const entries = Array.from(this.cache.values());
    const totalHits = entries.reduce((sum, entry) => sum + entry.hitCount, 0);
    const totalRequests = entries.length + totalHits;
    const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;
    
    const oldestTimestamp = entries.length > 0 
      ? Math.min(...entries.map(entry => entry.timestamp))
      : Date.now();
    
    return {
      size: this.cache.size,
      maxSize: this.CACHE_SIZE,
      hitRate,
      totalHits,
      oldestEntry: Date.now() - oldestTimestamp
    };
  }

  /**
   * 清空缓存
   */
  static clearCache(): void {
    this.cache.clear();
  }

  /**
   * 获取复杂度分析的可读描述
   */
  static getComplexityDescription(analysis: ComplexityAnalysis): string {
    const { score, category, factors } = analysis;
    
    let description = `复杂度分数: ${score}/100 (${category})`;
    
    const factorDescriptions = [];
    
    if (factors.textLength > 70) {
      factorDescriptions.push('文本较长');
    }
    
    if (factors.questionType === 'technical') {
      factorDescriptions.push('技术问题');
    } else if (factors.questionType === 'creative') {
      factorDescriptions.push('创意问题');
    } else if (factors.questionType === 'analytical') {
      factorDescriptions.push('分析问题');
    }
    
    if (factors.domainSpecific) {
      factorDescriptions.push('领域专业');
    }
    
    if (factors.multiStep) {
      factorDescriptions.push('多步骤');
    }
    
    if (factors.requiresReasoning) {
      factorDescriptions.push('需要推理');
    }

    if (factorDescriptions.length > 0) {
      description += ` - ${factorDescriptions.join(', ')}`;
    }

    return description;
  }
}