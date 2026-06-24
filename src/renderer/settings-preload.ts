import { contextBridge, ipcRenderer } from 'electron';

export interface SettingsSnapshot {
  port: number;
  pendingPort: number;
  settingsPath: string;
  displays: Array<{ id: string; name: string; isPrimary: boolean }>;
  security: { ipAllowlistEnabled: boolean; ipAllowlist: string[] };
  serverError: string | null;
  version: string;
}

contextBridge.exposeInMainWorld('pconairSettings', {
  get: (): Promise<SettingsSnapshot> => ipcRenderer.invoke('pconair:settings:get'),
  savePort: (port: number): Promise<{ ok: boolean; error?: string; restartRequired?: boolean }> =>
    ipcRenderer.invoke('pconair:settings:save-port', port),
  saveSecurity: (security: { ipAllowlistEnabled: boolean; ipAllowlist: string[] }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('pconair:settings:save-security', security),
  restart: (): Promise<void> => ipcRenderer.invoke('pconair:settings:restart'),
});
