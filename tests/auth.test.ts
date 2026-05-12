import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthManager, type AuthConfig } from '../src/main/auth';

const CONFIG: AuthConfig = {
  operatorPin: '1234',
  adminPin: 'supersecret',
  operatorSessionMs: 8 * 60 * 60 * 1000,
  adminSessionMs: 4 * 60 * 60 * 1000,
  maxFailures: 5,
  lockoutMs: 5 * 60 * 1000,
};

describe('AuthManager', () => {
  let auth: ReturnType<typeof createAuthManager>;

  beforeEach(() => {
    auth = createAuthManager(CONFIG);
  });

  it('creates an operator session with correct PIN', async () => {
    const session = await auth.createSession('operator', '1234', '127.0.0.1');
    expect(session).not.toBeNull();
    expect(session!.role).toBe('operator');
  });

  it('returns null with wrong operator PIN', async () => {
    const session = await auth.createSession('operator', 'wrong', '127.0.0.1');
    expect(session).toBeNull();
  });

  it('creates an admin session with correct PIN', async () => {
    const session = await auth.createSession('admin', 'supersecret', '127.0.0.1');
    expect(session).not.toBeNull();
    expect(session!.role).toBe('admin');
  });

  it('validates a live session', async () => {
    const session = await auth.createSession('operator', '1234', '127.0.0.1');
    const found = auth.getSession(session!.id);
    expect(found).not.toBeNull();
    expect(found!.role).toBe('operator');
  });

  it('invalidates a deleted session', async () => {
    const session = await auth.createSession('operator', '1234', '127.0.0.1');
    auth.deleteSession(session!.id);
    expect(auth.getSession(session!.id)).toBeNull();
  });

  it('rate-limits after maxFailures', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      await auth.createSession('operator', 'wrong', ip);
    }
    expect(auth.isLockedOut(ip)).toBe(true);
  });

  it('allows login from a different IP during lockout', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      await auth.createSession('operator', 'wrong', ip);
    }
    const session = await auth.createSession('operator', '1234', '10.0.0.2');
    expect(session).not.toBeNull();
  });

  it('rejects login from locked-out IP even with correct PIN', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      await auth.createSession('operator', 'wrong', ip);
    }
    const session = await auth.createSession('operator', '1234', ip);
    expect(session).toBeNull();
  });
});
