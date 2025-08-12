import { NextRequest, NextResponse } from 'next/server';
import { 
  getConversations, 
  getConversation, 
  createConversation,
  deleteConversation,
  updateConversationTitle,
  updateConversationSettings,
  searchConversations,
  getConversationStats
} from '@/lib/mongodb';
import { validateEnvVars } from '@/utils/helpers';

// GET - 获取对话列表或单个对话
export async function GET(request: NextRequest) {
  try {
    validateEnvVars();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const search = searchParams.get('search');
    const stats = searchParams.get('stats');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (stats === 'true') {
      // 获取统计信息
      const statistics = await getConversationStats();
      return NextResponse.json(statistics);
    }

    if (id) {
      // 获取单个对话
      const conversation = await getConversation(id);
      if (!conversation) {
        return NextResponse.json(
          { error: '对话不存在' },
          { status: 404 }
        );
      }
      return NextResponse.json(conversation);
    }

    if (search) {
      // 搜索对话
      const conversations = await searchConversations(search, limit);
      return NextResponse.json(conversations);
    }

    // 获取对话列表
    const conversations = await getConversations(limit);
    return NextResponse.json(conversations);
  } catch (error) {
    console.error('Get conversations error:', error);
    return NextResponse.json(
      { error: '获取对话列表失败' },
      { status: 500 }
    );
  }
}

// POST - 创建新对话
export async function POST(request: NextRequest) {
  try {
    validateEnvVars();

    const body = await request.json();
    const { title, model, settings = {} } = body;

    if (!title || !model) {
      return NextResponse.json(
        { error: '缺少必需参数：title 和 model' },
        { status: 400 }
      );
    }

    const conversation = await createConversation(title, model, settings);
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    console.error('Create conversation error:', error);
    return NextResponse.json(
      { error: '创建对话失败' },
      { status: 500 }
    );
  }
}

// PUT - 更新对话
export async function PUT(request: NextRequest) {
  try {
    validateEnvVars();

    const body = await request.json();
    const { id, title, settings } = body;

    if (!id) {
      return NextResponse.json(
        { error: '缺少必需参数：id' },
        { status: 400 }
      );
    }

    // 检查对话是否存在
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json(
        { error: '对话不存在' },
        { status: 404 }
      );
    }

    // 更新标题
    if (title !== undefined) {
      await updateConversationTitle(id, title);
    }

    // 更新设置
    if (settings !== undefined) {
      await updateConversationSettings(id, settings);
    }

    // 返回更新后的对话
    const updatedConversation = await getConversation(id);
    return NextResponse.json(updatedConversation);
  } catch (error) {
    console.error('Update conversation error:', error);
    return NextResponse.json(
      { error: '更新对话失败' },
      { status: 500 }
    );
  }
}

// DELETE - 删除对话
export async function DELETE(request: NextRequest) {
  try {
    validateEnvVars();

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: '缺少必需参数：id' },
        { status: 400 }
      );
    }

    // 检查对话是否存在
    const conversation = await getConversation(id);
    if (!conversation) {
      return NextResponse.json(
        { error: '对话不存在' },
        { status: 404 }
      );
    }

    await deleteConversation(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete conversation error:', error);
    return NextResponse.json(
      { error: '删除对话失败' },
      { status: 500 }
    );
  }
}
