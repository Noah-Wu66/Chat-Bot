import mongoose from 'mongoose';

declare global {
  // eslint-disable-next-line no-var
  var __mongoose_conn: Promise<typeof mongoose> | undefined;
}

export async function dbConnect(): Promise<typeof mongoose> {
  if (!process.env.MONGODB_URI) {
    throw new Error('Missing MONGODB_URI environment variable');
  }

  if (global.__mongoose_conn) {
    return global.__mongoose_conn;
  }

  global.__mongoose_conn = mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.MONGODB_DB || undefined,
  });

  return global.__mongoose_conn;
}


