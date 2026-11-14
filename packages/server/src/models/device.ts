// Ingest device (simulator process). Only the sha256 of its API key is stored.
import { model, Schema } from 'mongoose';

export interface DeviceDoc {
  name: string;
  keyHash: string;
  /** Source ids this device may publish for; '*' allows any. */
  allowedSources: string[];
  lastSeenAt?: Date;
}

const deviceSchema = new Schema<DeviceDoc>(
  {
    name: { type: String, required: true, trim: true },
    keyHash: { type: String, required: true, unique: true },
    allowedSources: { type: [String], default: ['*'] },
    lastSeenAt: { type: Date },
  },
  { timestamps: true },
);

export const Device = model<DeviceDoc>('Device', deviceSchema);
