import { NextResponse } from 'next/server';
import { openai } from '@/lib/openai';

export async function GET() {
  const testId = Math.random().toString(36).substring(7);
  console.log(`🧪 [API Test ${testId}] 开始连接测试`);
  
  try {
    // 测试基本连接
    console.log(`🔗 [API Test ${testId}] 测试 OpenAI 客户端配置`);
    console.log(`🔗 [API Test ${testId}] Base URL:`, process.env.AIHUBMIX_BASE_URL || 'https://aihubmix.com/v1');
    console.log(`🔗 [API Test ${testId}] API Key 长度:`, process.env.AIHUBMIX_API_KEY?.length || 0);

    // 尝试调用 GPT-5 模型
    console.log(`🚀 [API Test ${testId}] 测试 GPT-5 Responses API`);
    
    const testParams = {
      model: 'gpt-5',
      input: '请简单回复"测试成功"',
      stream: false,
      max_output_tokens: 50
    };

    console.log(`📋 [API Test ${testId}] 测试参数:`, testParams);

    const startTime = Date.now();
    const response = await (openai as any).responses.create(testParams);
    const endTime = Date.now();

    console.log(`✅ [API Test ${testId}] API 调用成功，耗时:`, endTime - startTime, 'ms');
    console.log(`📥 [API Test ${testId}] 响应:`, JSON.stringify(response, null, 2));

    return NextResponse.json({
      status: 'success',
      testId,
      duration: endTime - startTime,
      response: {
        content: response.content || response.output || '',
        reasoning: response.reasoning || '',
        usage: response.usage || {},
        model: response.model || 'gpt-5'
      },
      message: 'GPT-5 连接测试成功'
    });

  } catch (error) {
    console.error(`❌ [API Test ${testId}] 连接测试失败:`, error);

    const errorInfo = error instanceof Error ? {
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

    console.error(`❌ [API Test ${testId}] 错误详情:`, errorInfo);

    return NextResponse.json(
      {
        status: 'error',
        testId,
        error: {
          name: errorInfo.name,
          message: errorInfo.message,
          status: errorInfo.status,
          code: errorInfo.code,
          type: errorInfo.type
        },
        message: 'GPT-5 连接测试失败'
      },
      { status: 500 }
    );
  }
}
