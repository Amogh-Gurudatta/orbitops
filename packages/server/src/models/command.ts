// Audit trail of operator commands sent to satellites.
import { model, Schema } from 'mongoose';
import { COMMAND_KINDS, FAULT_KINDS } from '@orbitops/shared';

export interface CommandDoc {
  satId: number;
  kind: (typeof COMMAND_KINDS)[number];
  fault?: (typeof FAULT_KINDS)[number];
  issuedBy: string;
  issuedAt: Date;
  status: 'sent' | 'no_device';
}

const commandSchema = new Schema<CommandDoc>({
  satId: { type: Number, required: true },
  kind: { type: String, enum: COMMAND_KINDS, required: true },
  fault: { type: String, enum: FAULT_KINDS },
  issuedBy: { type: String, required: true },
  issuedAt: { type: Date, required: true, default: () => new Date() },
  status: { type: String, enum: ['sent', 'no_device'], required: true, default: 'sent' },
});
commandSchema.index({ satId: 1, issuedAt: -1 });
commandSchema.index({ issuedAt: -1 });

export const CommandModel = model<CommandDoc>('Command', commandSchema);
