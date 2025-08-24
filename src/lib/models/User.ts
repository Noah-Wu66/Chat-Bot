import mongoose, { Schema, models, model } from 'mongoose';
import { dbConnect } from '@/lib/db';

export interface IUserDoc extends mongoose.Document {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

const UserSchema = new Schema<IUserDoc>(
  {
    id: { type: String, index: true, unique: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false }
);

export const getUserModel = async () => {
  await dbConnect();
  return (models.User as mongoose.Model<IUserDoc>) || model<IUserDoc>('User', UserSchema);
};


