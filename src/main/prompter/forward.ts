/** Outcome of mirroring a command to a third-party prompter service. */
export type ForwardResult = 'off' | 'ok' | 'failed';

export interface ExternalPrompter {
  host: string;
  enabled: boolean;
}

/**
 * Mirror a command to a third-party prompter service, if the show has one
 * wired up alongside PConAir's own display. Best-effort by design: the local
 * prompter is the source of truth, so a service that is unplugged, asleep, or
 * simply slow must never take the built-in display down with it.
 */
export async function forwardToExternalPrompter(
  target: ExternalPrompter,
  patch: Record<string, unknown>
): Promise<ForwardResult> {
  if (!target.enabled || !target.host) return 'off';
  try {
    await fetch(`${target.host}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
      signal: AbortSignal.timeout(3000),
    });
    return 'ok';
  } catch {
    return 'failed';
  }
}
