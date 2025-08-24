import mongoose, { Schema, models, model } from 'mongoose';
import { dbConnect } from '@/lib/db';

export interface IMessageDoc {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'function';
  content: string;
  timestamp: Date;
  model?: string;
  images?: string[];
  functionCall?: { name: string; arguments: string };
  functionResult?: { name: string; result: string };
  metadata?: Record<string, any>;
}

export interface IConversationDoc {
  id: string;
  userId: string;
  title: string;
  messages: IMessageDoc[];
  createdAt: Date;
  updatedAt: Date;
  model: string;
  settings: Record<string, any>;
}

const MessageSchema = new Schema<any>(
  {
    id: { type: String, index: true },
    role: { type: String, enum: ['system', 'user', 'assistant', 'function'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: () => new Date() },
    model: { type: String },
    images: [{ type: String }],
    functionCall: { name: String, arguments: String },
    functionResult: { name: String, result: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const ConversationSchema = new Schema<any>(
  {
    id: { type: String, index: true, unique: true },
    userId: { type: String, index: true },
    title: { type: String, required: true },
    messages: { type: [MessageSchema], default: [] },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
    model: { type: String, required: true },
    settings: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false }
);

export const getConversationModel = async () => {
  await dbConnect();
  return (
    (models.Conversation as mongoose.Model<any>) ||
    model<any>('Conversation', ConversationSchema)
  );
};


