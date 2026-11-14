// /ground-stations: the static station list used for visibility and pass prediction.
import { Router } from 'express';
import { GroundStation } from '../../models/index.js';

export function createGroundStationsRouter(): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    const stations = await GroundStation.find({}, { _id: 0, __v: 0, loc: 0 })
      .sort({ id: 1 })
      .lean();
    res.json({ stations });
  });
  return router;
}
