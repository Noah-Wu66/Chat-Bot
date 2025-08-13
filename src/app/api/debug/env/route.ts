import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const envCheck = {
      hasApiKey: !!process.env.AIHUBMIX_API_KEY,
      apiKeyLength: process.env.AIHUBMIX_API_KEY?.length || 0,
      apiKeyPrefix: process.env.AIHUBMIX_API_KEY?.substring(0, 10) + '...',
      baseUrl: process.env.AIHUBMIX_BASE_URL || 'https://aihubmix.com/v1',
      nodeEnv: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    };

    console.log('🔍 [Debug] 环境变量检查:', envCheck);

    return NextResponse.json({
      status: 'ok',
      environment: envCheck,
      message: '环境变量检查完成'
    });
  } catch (error) {
    console.error('❌ [Debug] 环境变量检查失败:', error);
    return NextResponse.json(
      { 
        status: 'error',
        error: error.message,
        message: '环境变量检查失败'
      },
      { status: 500 }
    );
  }
}
