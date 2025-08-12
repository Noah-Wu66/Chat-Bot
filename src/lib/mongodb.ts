import mongoose from 'mongoose';
import { Message, Conversation, ConversationSettings } from './types';

// MongoDB 连接
let isConnected = false;

export async function connectToDatabase() {
  if (isConnected) {
    return;
  }

  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }

    await mongoose.connect(mongoUri);
    isConnected = true;
    console.log('Connected to MongoDB');
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
    throw error;
  }
}

// 消息 Schema
const MessageSchema = new mongoose.Schema({
  id: { type: String, required: true },
  role: { 
    type: String, 
    required: true, 
    enum: ['system', 'user', 'assistant', 'function'] 
  },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  model: { type: String },
  images: [{ type: String }],
  functionCall: {
    name: { type: String },
    arguments: { type: String },
  },
  functionResult: {
    name: { type: String },
    result: { type: String },
  },
  metadata: {
    reasoning: { type: String },
    verbosity: { 
      type: String, 
      enum: ['low', 'medium', 'high'] 
    },
    effort: { 
      type: String, 
      enum: ['minimal', 'low', 'medium', 'high'] 
    },
    searchUsed: { type: Boolean },
    tokensUsed: { type: Number },
  },
});

// 对话设置 Schema
const ConversationSettingsSchema = new mongoose.Schema({
  temperature: { type: Number, min: 0, max: 2 },
  maxTokens: { type: Number, min: 1 },
  topP: { type: Number, min: 0, max: 1 },
  frequencyPenalty: { type: Number, min: -2, max: 2 },
  presencePenalty: { type: Number, min: -2, max: 2 },
  seed: { type: Number },
  reasoning: {
    effort: { 
      type: String, 
      enum: ['minimal', 'low', 'medium', 'high'],
      default: 'medium'
    },
  },
  text: {
    verbosity: { 
      type: String, 
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
  },
  webSearch: { type: Boolean, default: false },
  stream: { type: Boolean, default: true },
});

// 对话 Schema
const ConversationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  title: { type: String, required: true },
  messages: [MessageSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  model: { type: String, required: true },
  settings: { type: ConversationSettingsSchema, default: {} },
});

// 更新时间中间件
ConversationSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// 模型定义
export const ConversationModel = mongoose.models.Conversation || 
  mongoose.model('Conversation', ConversationSchema);

// 数据库操作函数

// 辅助函数：转换 MongoDB 文档为 Conversation 类型
function transformConversation(doc: any): Conversation {
  const { _id, __v, ...rest } = doc;
  return {
    ...rest,
    // 确保所有必需字段存在
    id: rest.id,
    title: rest.title,
    messages: rest.messages || [],
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    model: rest.model,
    settings: rest.settings || {},
  };
}

// 创建新对话
export async function createConversation(
  title: string, 
  model: string, 
  settings: ConversationSettings = {}
): Promise<Conversation> {
  await connectToDatabase();
  
  const conversationId = new mongoose.Types.ObjectId().toString();
  const conversation = new ConversationModel({
    id: conversationId,
    title,
    model,
    messages: [],
    settings,
  });
  
  await conversation.save();
  return conversation.toObject();
}

// 获取对话列表
export async function getConversations(limit = 50): Promise<Conversation[]> {
  await connectToDatabase();

  const conversations = await ConversationModel
    .find({})
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return conversations.map(transformConversation);
}

// 获取单个对话
export async function getConversation(id: string): Promise<Conversation | null> {
  await connectToDatabase();

  const conversation = await ConversationModel
    .findOne({ id })
    .lean();

  return conversation ? transformConversation(conversation) : null;
}

// 添加消息到对话
export async function addMessageToConversation(
  conversationId: string, 
  message: Omit<Message, 'id' | 'timestamp'>
): Promise<Message> {
  await connectToDatabase();
  
  const messageId = new mongoose.Types.ObjectId().toString();
  const newMessage: Message = {
    ...message,
    id: messageId,
    timestamp: new Date(),
  };
  
  await ConversationModel.updateOne(
    { id: conversationId },
    { 
      $push: { messages: newMessage },
      $set: { updatedAt: new Date() }
    }
  );
  
  return newMessage;
}

// 更新对话标题
export async function updateConversationTitle(
  conversationId: string, 
  title: string
): Promise<void> {
  await connectToDatabase();
  
  await ConversationModel.updateOne(
    { id: conversationId },
    { 
      $set: { 
        title,
        updatedAt: new Date()
      }
    }
  );
}

// 更新对话设置
export async function updateConversationSettings(
  conversationId: string, 
  settings: ConversationSettings
): Promise<void> {
  await connectToDatabase();
  
  await ConversationModel.updateOne(
    { id: conversationId },
    { 
      $set: { 
        settings,
        updatedAt: new Date()
      }
    }
  );
}

// 删除对话
export async function deleteConversation(conversationId: string): Promise<void> {
  await connectToDatabase();
  
  await ConversationModel.deleteOne({ id: conversationId });
}

// 搜索对话
export async function searchConversations(
  query: string,
  limit = 20
): Promise<Conversation[]> {
  await connectToDatabase();

  const conversations = await ConversationModel
    .find({
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { 'messages.content': { $regex: query, $options: 'i' } }
      ]
    })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return conversations.map(transformConversation);
}

// 获取对话统计信息
export async function getConversationStats() {
  await connectToDatabase();
  
  const stats = await ConversationModel.aggregate([
    {
      $group: {
        _id: null,
        totalConversations: { $sum: 1 },
        totalMessages: { $sum: { $size: '$messages' } },
        modelsUsed: { $addToSet: '$model' },
      }
    }
  ]);
  
  return stats[0] || {
    totalConversations: 0,
    totalMessages: 0,
    modelsUsed: [],
  };
}
