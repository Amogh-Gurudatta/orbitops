// Ground station site used for visibility and pass prediction; `loc` enables geo queries.
import { model, Schema } from 'mongoose';

export interface GroundStationDoc {
  id: string;
  name: string;
  network: string;
  lat: number;
  lon: number;
  altKm: number;
  minElevDeg: number;
  loc: { type: 'Point'; coordinates: [number, number] };
}

const groundStationSchema = new Schema<GroundStationDoc>({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  network: { type: String, required: true },
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  altKm: { type: Number, required: true },
  minElevDeg: { type: Number, required: true },
  loc: {
    type: { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
});
groundStationSchema.index({ loc: '2dsphere' });

export const GroundStation = model<GroundStationDoc>('GroundStation', groundStationSchema);
