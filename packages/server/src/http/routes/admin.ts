// Admin-only management: operator accounts (/users) and ingest device keys (/devices).
import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { ROLES } from '@orbitops/shared';
import { generateDeviceKey, hashDeviceKey } from '../../auth/deviceKey.js';
import { requireRole } from '../../auth/middleware.js';
import { hashPassword } from '../../auth/password.js';
import { Device, User } from '../../models/index.js';
import { HttpError } from '../errors.js';

const MONGO_DUPLICATE_KEY = 11000;

const CreateUser = z.strictObject({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(256),
  role: z.enum(ROLES).default('viewer'),
});
const UpdateUser = z.strictObject({ role: z.enum(ROLES) });
const CreateDevice = z.strictObject({
  name: z.string().trim().min(1).max(100),
  allowedSources: z.array(z.string().min(1).max(32)).min(1).max(100).default(['*']),
});
const IdParams = z.strictObject({ id: z.string().min(1).max(64) });

const objectId = (raw: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(raw)) throw new HttpError(404, 'not_found');
  return new Types.ObjectId(raw);
};

const userWire = (doc: {
  _id: { toString(): string };
  email: string;
  name: string;
  role: string;
}) => ({
  id: doc._id.toString(),
  email: doc.email,
  name: doc.name,
  role: doc.role,
});

const deviceWire = (doc: {
  _id: { toString(): string };
  name: string;
  allowedSources: string[];
  lastSeenAt?: Date | undefined;
  createdAt?: Date | undefined;
}) => ({
  id: doc._id.toString(),
  name: doc.name,
  allowedSources: doc.allowedSources,
  ...(doc.lastSeenAt ? { lastSeenAt: doc.lastSeenAt.getTime() } : {}),
  ...(doc.createdAt ? { createdAt: doc.createdAt.getTime() } : {}),
});

/** Mounted at /users behind requireAuth; admin only. */
export function createUsersRouter(): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/', async (_req, res) => {
    const users = await User.find({}, { passwordHash: 0 }).sort({ email: 1 }).lean();
    res.json({ users: users.map(userWire) });
  });

  router.post('/', async (req, res) => {
    const body = CreateUser.parse(req.body);
    try {
      const doc = await User.create({
        email: body.email,
        name: body.name,
        role: body.role,
        passwordHash: await hashPassword(body.password),
      });
      res.status(201).json({ user: userWire(doc) });
    } catch (err) {
      if ((err as { code?: number }).code === MONGO_DUPLICATE_KEY) {
        throw new HttpError(409, 'email_taken');
      }
      throw err;
    }
  });

  router.patch('/:id', async (req, res) => {
    const { id } = IdParams.parse(req.params);
    const { role } = UpdateUser.parse(req.body);
    // Prevents an admin from locking themselves (and possibly everyone) out of administration.
    if (id === req.user?.id) throw new HttpError(400, 'cannot_change_own_role');
    const doc = await User.findByIdAndUpdate(
      objectId(id),
      { $set: { role } },
      { returnDocument: 'after', lean: true },
    );
    if (!doc) throw new HttpError(404, 'user_not_found');
    res.json({ user: userWire(doc) });
  });

  return router;
}

/** Mounted at /devices behind requireAuth; admin only. */
export function createDevicesRouter(): Router {
  const router = Router();
  router.use(requireRole('admin'));

  router.get('/', async (_req, res) => {
    const devices = await Device.find({}, { keyHash: 0 }).sort({ name: 1 }).lean();
    res.json({ devices: devices.map(deviceWire) });
  });

  router.post('/', async (req, res) => {
    const body = CreateDevice.parse(req.body);
    const key = generateDeviceKey();
    const doc = await Device.create({
      name: body.name,
      allowedSources: body.allowedSources,
      keyHash: hashDeviceKey(key),
    });
    // The plaintext key is shown exactly once; only its sha256 is stored.
    res.status(201).json({ device: deviceWire(doc.toObject()), key });
  });

  router.delete('/:id', async (req, res) => {
    const { id } = IdParams.parse(req.params);
    const removed = await Device.findByIdAndDelete(objectId(id)).lean();
    if (!removed) throw new HttpError(404, 'device_not_found');
    res.status(204).end();
  });

  return router;
}
