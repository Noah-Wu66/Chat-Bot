import mongoose, { Schema, models, model } from 'mongoose';
import { dbConnect } from '@/lib/db';

export interface IRunLogDoc {
  id: string;
  requestId: string;
  route: 'responses' | 'chat' | 'router' | 'conversations' | 'auth';
  level: 'info' | 'warn' | 'error';
  stage: string; // e.g. request.start, routing.start, routing.done, api.error, fallback.start, done
  message: string;
  meta?: Record<string, any>;
  createdAt: Date;
}

const RunLogSchema = new Schema<any>(
  {
    id: { type: String, index: true },
    requestId: { type: String, index: true },
    route: { type: String, enum: ['responses', 'chat', 'router', 'conversations', 'auth'], required: true },
    level: { type: String, enum: ['info', 'warn', 'error'], required: true },
    stage: { type: String, required: true },
    message: { type: String, required: true },
    meta: { type: Schema.Types.Mixed },
    createdAt: { type: Date, default: () => new Date(), index: true },
  },
  { versionKey: false }
);

export const getRunLogModel = async () => {
  await dbConnect();
  return (
    (models.RunLog as mongoose.Model<any>) || model<any>('RunLog', RunLogSchema)
  );
};


