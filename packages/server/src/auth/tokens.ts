// JWT issuing/verification (jose, HS256). Three token uses share one secret but are not interchangeable.
import { jwtVerify, SignJWT } from 'jose';
import { ROLES, type Role } from '@orbitops/shared';

export type TokenUse = 'access' | 'refresh' | 'socket';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

const LIFETIME: Record<TokenUse, string> = { access: '15m', refresh: '7d', socket: '60s' };
export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 7 * 24 * 3_600_000;

const ISSUER = 'orbitops';

export interface TokenService {
  sign(use: TokenUse, user: AuthUser): Promise<string>;
  /** Returns the user for a valid token of the expected use, otherwise null (never throws). */
  verify(token: string | undefined, use: TokenUse): Promise<AuthUser | null>;
}

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);
  return {
    sign(use, user) {
      return new SignJWT({ use, email: user.email, name: user.name, role: user.role })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(user.id)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(LIFETIME[use])
        .sign(key);
    },
    async verify(token, use) {
      if (!token) return null;
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER });
        const { sub, use: tokenUse, email, name, role } = payload;
        if (tokenUse !== use || typeof sub !== 'string') return null;
        if (typeof email !== 'string' || typeof name !== 'string') return null;
        if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return null;
        return { id: sub, email, name, role: role as Role };
      } catch {
        return null;
      }
    },
  };
}
