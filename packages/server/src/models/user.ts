// Operator account. Passwords are stored only as argon2id hashes.
import { model, Schema } from 'mongoose';
import { ROLES, type Role } from '@orbitops/shared';

export interface UserDoc {
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
}

const userSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ROLES, required: true, default: 'viewer' },
  },
  { timestamps: true },
);

export const User = model<UserDoc>('User', userSchema);
