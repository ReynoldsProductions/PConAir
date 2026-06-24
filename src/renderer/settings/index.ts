import type { SettingsSnapshot } from '../settings-preload';

declare global {
  interface Window {
    pconairSettings: {
      get(): Promise<SettingsSnapshot>;
      savePort(port: number): Promise<{ ok: boolean; error?: string; restartRequired?: boolean }>;
      saveSecurity(security: { ipAllowlistEnabled: boolean; ipAllowlist: string[] }): Promise<{ ok: boolean; error?: string }>;
      restart(): Promise<void>;
    };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

async function load(): Promise<void> {
  const snap = await window.pconairSettings.get();

  $<HTMLInputElement>('port').value = String(snap.pendingPort);
  $<HTMLInputElement>('allowlist-enabled').checked = snap.security.ipAllowlistEnabled;
  $<HTMLTextAreaElement>('allowlist').value = snap.security.ipAllowlist.join('\n');

  const list = $<HTMLUListElement>('displays');
  list.innerHTML = '';
  for (const d of snap.displays) {
    const li = document.createElement('li');
    li.textContent = d.isPrimary ? `${d.name} (primary)` : d.name;
    list.appendChild(li);
  }

  $<HTMLParagraphElement>('about').textContent = `PConAir ${snap.version} — settings file: ${snap.settingsPath}`;

  const banner = $<HTMLDivElement>('server-error');
  if (snap.serverError) {
    banner.textContent = `The server failed to start: ${snap.serverError}. Fix the port below and restart.`;
    banner.style.display = 'block';
  }

  if (snap.pendingPort !== snap.port) {
    $<HTMLSpanElement>('save-status').textContent = `Saved port ${snap.pendingPort} takes effect on restart (running on ${snap.port}).`;
  }
}

$<HTMLButtonElement>('save-port').addEventListener('click', async () => {
  const port = parseInt($<HTMLInputElement>('port').value, 10);
  const status = $<HTMLSpanElement>('save-status');
  const r = await window.pconairSettings.savePort(port);
  status.textContent = r.ok
    ? r.restartRequired
      ? 'Saved — restart to apply.'
      : 'Saved.'
    : r.error ?? 'Save failed.';
});

$<HTMLButtonElement>('save-security').addEventListener('click', async () => {
  const enabled = $<HTMLInputElement>('allowlist-enabled').checked;
  const entries = $<HTMLTextAreaElement>('allowlist')
    .value.split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const status = $<HTMLSpanElement>('security-status');
  const r = await window.pconairSettings.saveSecurity({ ipAllowlistEnabled: enabled, ipAllowlist: entries });
  status.textContent = r.ok ? 'Saved — applies immediately.' : r.error ?? 'Save failed.';
});

$<HTMLButtonElement>('restart').addEventListener('click', () => {
  void window.pconairSettings.restart();
});

void load();
