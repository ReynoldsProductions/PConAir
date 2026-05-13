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
  /** Sliding window for counting failures (ms). */
  failureWindowMs: number;
  lockoutMs: number;
}

interface IpAuthState {
  /** Timestamps of failed PIN attempts within the sliding window. */
  failureTimes: number[];
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

function pruneFailures(rec: IpAuthState, now: number, windowMs: number): void {
  const cutoff = now - windowMs;
  rec.failureTimes = rec.failureTimes.filter((t) => t > cutoff);
}

export function createAuthManager(config: AuthConfig) {
  const { operatorHash, adminHash } = resolvePinHashes(config);
  const windowMs = config.failureWindowMs;

  const sessions = new Map<string, Session>();
  const ipAuth = new Map<string, IpAuthState>();

  function getIpRec(ip: string): IpAuthState {
    let rec = ipAuth.get(ip);
    if (!rec) {
      rec = { failureTimes: [], lockedUntil: null };
      ipAuth.set(ip, rec);
    }
    return rec;
  }

  function isLockedOut(ip: string): boolean {
    const rec = ipAuth.get(ip);
    if (!rec || rec.lockedUntil === null) return false;
    if (Date.now() < rec.lockedUntil) return true;
    rec.lockedUntil = null;
    rec.failureTimes = [];
    return false;
  }

  function recordFailure(ip: string): void {
    const now = Date.now();
    const rec = getIpRec(ip);
    if (rec.lockedUntil !== null && now < rec.lockedUntil) return;

    pruneFailures(rec, now, windowMs);
    rec.failureTimes.push(now);
    pruneFailures(rec, now, windowMs);

    if (rec.failureTimes.length >= config.maxFailures) {
      rec.lockedUntil = now + config.lockoutMs;
      rec.failureTimes = [];
    }
    ipAuth.set(ip, rec);
  }

  function recordSuccess(ip: string): void {
    ipAuth.delete(ip);
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
    const id = randomBytes(16).toString('base64');
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
    if (isLockedOut(ip)) return 0;
    const now = Date.now();
    const rec = ipAuth.get(ip);
    if (!rec) return config.maxFailures;
    pruneFailures(rec, now, windowMs);
    return Math.max(0, config.maxFailures - rec.failureTimes.length);
  }

  function getRetryAfterSeconds(ip: string): number | null {
    const rec = ipAuth.get(ip);
    if (!rec?.lockedUntil) return null;
    return Math.max(0, Math.ceil((rec.lockedUntil - Date.now()) / 1000));
  }

  function getRateLimitResetUnix(ip: string): number | null {
    const rec = ipAuth.get(ip);
    if (!rec?.lockedUntil) return null;
    return Math.ceil(rec.lockedUntil / 1000);
  }

  /** Creates a session without PIN verification — for trusted internal callers (Electron main process only). */
  function createTrustedSession(role: 'operator' | 'admin'): Session {
    const id = randomBytes(16).toString('base64');
    const now = Date.now();
    const durationMs = role === 'operator' ? config.operatorSessionMs : config.adminSessionMs;
    const session: Session = { id, role, createdAt: now, expiresAt: now + durationMs };
    sessions.set(id, session);
    return session;
  }

  async function verifyOperatorPin(pin: string): Promise<boolean> {
    return bcrypt.compare(pin, operatorHash);
  }

  async function verifyAdminPin(pin: string): Promise<boolean> {
    return bcrypt.compare(pin, adminHash);
  }

  /** Records a failed admin PIN attempt (unlock-admin) for rate limiting. */
  function recordAdminPinFailure(ip: string): void {
    recordFailure(ip);
  }

  /** Clears failure state after successful admin PIN verification outside createSession. */
  function recordAdminPinSuccess(ip: string): void {
    recordSuccess(ip);
  }

  return {
    createSession,
    createTrustedSession,
    getSession,
    deleteSession,
    isLockedOut,
    getRemainingAttempts,
    getRetryAfterSeconds,
    getRateLimitResetUnix,
    verifyOperatorPin,
    verifyAdminPin,
    recordAdminPinFailure,
    recordAdminPinSuccess,
  };
}

export type AuthManager = ReturnType<typeof createAuthManager>;
