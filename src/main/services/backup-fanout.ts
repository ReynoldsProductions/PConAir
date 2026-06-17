import http from 'http';

/**
 * Fire-and-forget HTTP POST fan-out to a list of backup machine IPs.
 * Each request is sent in parallel with a 2-second timeout.
 * Failures are logged but never thrown — the primary machine is never
 * blocked by a backup that is unreachable.
 *
 * Pure function: no Electron imports, fully testable in Node.
 */
export async function fanOutSlideCommand(
  backupIps: string[],
  port: number,
  endpoint: string,
  body: Record<string, unknown>,
  log: (msg: string) => void,
): Promise<void> {
  if (backupIps.length === 0) return;

  const payload = JSON.stringify(body);

  backupIps.forEach((ip) => {
    const options: http.RequestOptions = {
      hostname: ip,
      port,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 2000,
    };

    const req = http.request(options, (res) => {
      // Drain the response so the socket is released
      res.resume();
      log(`[Backup] Sent ${endpoint} to ${ip}:${port} → ${res.statusCode}`);
    });

    req.on('timeout', () => {
      req.destroy();
      log(`[Backup] Timeout sending ${endpoint} to ${ip}:${port}`);
    });

    req.on('error', (err) => {
      log(`[Backup] Failed to send ${endpoint} to ${ip}:${port}: ${err.message}`);
    });

    req.write(payload);
    req.end();
  });
}
