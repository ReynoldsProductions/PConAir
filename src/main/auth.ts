import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import type { Session } from '../shared/types';

export interface AuthConfig {
  /** Plaintext pins (development / first boot). */
  operatorPin?: string;
  adminPin?: string;
  /** Bcrypt hashes from show profile (preferred when profiles are enabled). */
  operatorPinHash?: string;
  adminPinHash?: string;
  operatorSessionMs: number;
  adminSessionMs: number;
  maxFailures: number;
  lockoutMs: number;
}

interface FailureRecord {
  count: number;
  lockedUntil: number | null;
}

function resolvePinHashes(config: AuthConfig): { operatorHash: string; adminHash: string } {
  if (config.operatorPinHash && config.adminPinHash) {
    return { operatorHash: config.operatorPinHash, adminHash: config.adminPinHash };
  }
  if (config.operatorPin && config.adminPin) {
    return {
      operatorHash: bcrypt.hashSync(config.operatorPin, 12),
      adminHash: bcrypt.hashSync(config.adminPin, 12),
    };
  }
  throw new Error('AuthConfig requires operatorPin+adminPin or operatorPinHash+adminPinHash');
}

export function createAuthManager(config: AuthConfig) {
  const { operatorHash, adminHash } = resolvePinHashes(config);

  const sessions = new Map<string, Session>();
  const failures = new Map<string, FailureRecord>();

  function isLockedOut(ip: string): boolean {
    const rec = failures.get(ip);
    if (!rec || rec.lockedUntil === null) return false;
    if (Date.now() < rec.lockedUntil) return true;
    failures.delete(ip);
    return false;
  }

  function recordFailure(ip: string): void {
    const rec = failures.get(ip) ?? { count: 0, lockedUntil: null };
    rec.count += 1;
    if (rec.count >= config.maxFailures) {
      rec.lockedUntil = Date.now() + config.lockoutMs;
    }
    failures.set(ip, rec);
  }

  function recordSuccess(ip: string): void {
    failures.delete(ip);
  }

  async function createSession(
    role: 'operator' | 'admin',
    pin: string,
    ip: string
  ): Promise<Session | null> {
    if (isLockedOut(ip)) return null;

    const hash = role === 'operator' ? operatorHash : adminHash;
    const valid = await bcrypt.compare(pin, hash);

    if (!valid) {
      recordFailure(ip);
      return null;
    }

    recordSuccess(ip);
    const id = randomBytes(16).toString('base64url');
    const now = Date.now();
    const durationMs =
      role === 'operator' ? config.operatorSessionMs : config.adminSessionMs;
    const session: Session = { id, role, createdAt: now, expiresAt: now + durationMs };
    sessions.set(id, session);
    return session;
  }

  function getSession(id: string): Session | null {
    const session = sessions.get(id);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      sessions.delete(id);
      return null;
    }
    return session;
  }

  function deleteSession(id: string): void {
    sessions.delete(id);
  }

  function getRemainingAttempts(ip: string): number {
    const rec = failures.get(ip);
    if (!rec) return config.maxFailures;
    return Math.max(0, config.maxFailures - rec.count);
  }

  function getRetryAfterSeconds(ip: string): number | null {
    const rec = failures.get(ip);
    if (!rec?.lockedUntil) return null;
    return Math.max(0, Math.ceil((rec.lockedUntil - Date.now()) / 1000));
  }

  async function verifyOperatorPin(pin: string): Promise<boolean> {
    return bcrypt.compare(pin, operatorHash);
  }

  return {
    createSession,
    getSession,
    deleteSession,
    isLockedOut,
    getRemainingAttempts,
    getRetryAfterSeconds,
    verifyOperatorPin,
  };
}

export type AuthManager = ReturnType<typeof createAuthManager>;
