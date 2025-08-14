import mongoose from 'mongoose';
import { Message, Conversation, ConversationSettings, User } from './types';

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

// 用户 Schema
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const UserModel = mongoose.models.User || mongoose.model('User', UserSchema);

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
  userId: { type: String, required: true, index: true },
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
    userId: rest.userId,
    title: rest.title,
    messages: rest.messages || [],
    createdAt: rest.createdAt,
    updatedAt: rest.updatedAt,
    model: rest.model,
    settings: rest.settings || {},
  };
}

// 辅助函数：转换 MongoDB 文档为 User 类型
function transformUser(doc: any): User {
  const { _id, __v, ...rest } = doc;
  return {
    id: rest.id,
    username: rest.username,
    email: rest.email,
    passwordHash: rest.passwordHash,
    createdAt: rest.createdAt,
  };
}

// 创建新对话
export async function createConversation(
  title: string,
  model: string,
  settings: ConversationSettings = {},
  userId: string
): Promise<Conversation> {
  await connectToDatabase();

  const conversationId = new mongoose.Types.ObjectId().toString();
  const conversation = new ConversationModel({
    id: conversationId,
    userId,
    title,
    model,
    messages: [],
    settings,
  });

  await conversation.save();
  return conversation.toObject();
}

// 获取对话列表
export async function getConversations(userId: string, limit = 50): Promise<Conversation[]> {
  await connectToDatabase();

  const conversations = await ConversationModel
    .find({ userId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean();

  return conversations.map(transformConversation);
}

// 获取单个对话
export async function getConversation(id: string, userId: string): Promise<Conversation | null> {
  await connectToDatabase();

  const conversation = await ConversationModel
    .findOne({ id, userId })
    .lean();

  return conversation ? transformConversation(conversation) : null;
}

// 添加消息到对话
export async function addMessageToConversation(
  conversationId: string,
  message: Omit<Message, 'id' | 'timestamp'>,
  userId: string
): Promise<Message> {
  await connectToDatabase();

  const messageId = new mongoose.Types.ObjectId().toString();
  const newMessage: Message = {
    ...message,
    id: messageId,
    timestamp: new Date(),
  };

  await ConversationModel.updateOne(
    { id: conversationId, userId },
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
  title: string,
  userId: string
): Promise<void> {
  await connectToDatabase();

  await ConversationModel.updateOne(
    { id: conversationId, userId },
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
  settings: ConversationSettings,
  userId: string
): Promise<void> {
  await connectToDatabase();

  await ConversationModel.updateOne(
    { id: conversationId, userId },
    {
      $set: {
        settings,
        updatedAt: new Date()
      }
    }
  );
}

// 删除对话
export async function deleteConversation(conversationId: string, userId: string): Promise<void> {
  await connectToDatabase();

  await ConversationModel.deleteOne({ id: conversationId, userId });
}

// 搜索对话
export async function searchConversations(
  userId: string,
  query: string,
  limit = 20
): Promise<Conversation[]> {
  await connectToDatabase();

  const conversations = await ConversationModel
    .find({
      userId,
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
export async function getConversationStats(userId: string) {
  await connectToDatabase();

  const stats = await ConversationModel.aggregate([
    { $match: { userId } },
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


// ========== 用户相关操作 ==========
export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  await connectToDatabase();
  const user = await UserModel.findOne({ username }).lean();
  return user ? transformUser(user) : null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  await connectToDatabase();
  const user = await UserModel.findOne({ email }).lean();
  return user ? transformUser(user) : null;
}

export async function findUserByUsernameOrEmail(identifier: string): Promise<User | null> {
  await connectToDatabase();
  const user = await UserModel.findOne({
    $or: [{ username: identifier }, { email: identifier }]
  }).lean();
  return user ? transformUser(user) : null;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  await connectToDatabase();
  const id = new mongoose.Types.ObjectId().toString();
  const user = new UserModel({ id, ...input });
  await user.save();
  return transformUser(user.toObject());
}

export async function isUsernameOrEmailTaken(username: string, email: string) {
  await connectToDatabase();
  const exists = await UserModel.exists({ $or: [{ username }, { email }] });
  return !!exists;
}
