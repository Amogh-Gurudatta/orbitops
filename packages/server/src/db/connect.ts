// Mongoose connection lifecycle. `sanitizeFilter` strips operator injection from user-supplied filters.
import mongoose from 'mongoose';

export async function connectDb(uri: string): Promise<typeof mongoose> {
  mongoose.set('sanitizeFilter', true);
  return mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

/** The native driver database, for the telemetry hot path that bypasses Mongoose. */
export function nativeDb() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('MongoDB is not connected');
  return db;
}
