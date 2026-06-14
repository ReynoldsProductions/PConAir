/**
 * backup-broadcast.ts
 *
 * Fire-and-forget HTTP POST to each configured backup machine IP.
 * Used by the primary machine to keep backup machines in sync with
 * slide-control commands (next, prev, goto, load).
 *
 * Failures are logged at warn level and never thrown — a dead backup
 * must never stall the primary.
 */

const TIMEOUT_MS = 2000;

/**
 * POST `path` with `body` (JSON) to every IP in `backupIps`, in parallel.
 * Fire-and-forget: the returned Promise resolves once all requests have been
 * dispatched (not awaited for completion). Individual request results are
 * logged via `log` but never surface as errors.
 */
export async function broadcastToBackups(
  backupIps: string[],
  path: string,
  body: unknown,
  log: (msg: string) => void,
): Promise<void> {
  if (backupIps.length === 0) return;

  const payload = JSON.stringify(body);

  const tasks = backupIps.map(async (ip) => {
    const url = `http://${ip}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
      log(`[Backup] Successfully sent ${path} to ${ip}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      if (isTimeout) {
        log(`[Backup] Timeout sending ${path} to ${ip}`);
      } else {
        log(`[Backup] Failed to send ${path} to ${ip}: ${msg}`);
      }
    } finally {
      clearTimeout(timer);
    }
  });

  // Await all in parallel; individual failures are swallowed above.
  await Promise.all(tasks);
}
