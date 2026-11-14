// Fleet catalogue entry: identity plus the TLE the simulator and pass predictor propagate.
import { model, Schema } from 'mongoose';
import { SAT_GROUPS, type SatGroup } from '@orbitops/shared';

export interface SatelliteDoc {
  satId: number;
  name: string;
  group: SatGroup;
  line1: string;
  line2: string;
  epoch: Date;
}

const satelliteSchema = new Schema<SatelliteDoc>(
  {
    satId: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    group: { type: String, enum: SAT_GROUPS, required: true, index: true },
    line1: { type: String, required: true },
    line2: { type: String, required: true },
    epoch: { type: Date, required: true },
  },
  { timestamps: true },
);

export const Satellite = model<SatelliteDoc>('Satellite', satelliteSchema);
