import { cookies } from 'next/headers';
import crypto from 'crypto';
import type { NextRequest } from 'next/server';

const AUTH_COOKIE = 'auth_token';
const ALG = 'HS256';

function getSecret(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!secret) throw new Error('Missing NEXTAUTH_SECRET');
  return Buffer.from(secret, 'utf8');
}

// Simple JWT (HS256) - no external deps
function base64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export interface JWTPayload {
  sub: string; // userId
  username: string;
  email: string;
  iat: number;
  exp?: number;
}

export function signJWT(payload: JWTPayload, expiresInSec?: number) {
  const header = { alg: ALG, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body: JWTPayload = { ...payload, iat: now };
  if (expiresInSec) body.exp = now + expiresInSec;
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(body));
  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest();
  const encSig = base64url(sig);
  return `${data}.${encSig}`;
}

export function verifyJWT(token: string): JWTPayload | null {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const data = `${h}.${p}`;
    const expected = base64url(
      crypto.createHmac('sha256', getSecret()).update(data).digest()
    );
    if (!crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return null;
    // base64url -> base64
    const norm = p.replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm + '==='.slice((norm.length + 3) % 4);
    const payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as JWTPayload;
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Password hashing using scrypt
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey as Buffer);
    });
  });
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, saltHex, keyHex] = stored.split(':');
    if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const key = Buffer.from(keyHex, 'hex');
    const derived = await new Promise<Buffer>((resolve, reject) => {
      crypto.scrypt(password, salt, key.length, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey as Buffer);
      });
    });
    return crypto.timingSafeEqual(derived, key);
  } catch {
    return false;
  }
}

export function setAuthCookie(token: string, remember = false) {
  const cookieStore = cookies();
  cookieStore.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}), // 30 days
  });
}

export function clearAuthCookie() {
  const cookieStore = cookies();
  cookieStore.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function getTokenFromRequest(req: NextRequest): string | null {
  const cookieHeader = req.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|; )auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAuthUserFromRequest(req: NextRequest): JWTPayload | null {
  const token = getTokenFromRequest(req);
  if (!token) return null;
  return verifyJWT(token);
}

export const AuthConfig = { AUTH_COOKIE };

