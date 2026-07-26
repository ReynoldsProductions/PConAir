import { contextBridge, ipcRenderer } from 'electron';

export interface DirectorOfficeSnapshot {
  id: string;
  name: string;
  baseUrl: string;
  status: 'connecting' | 'online' | 'offline' | 'auth_error';
  state: unknown;
}

export type DirectorActionResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: { code: string; message: string } };

contextBridge.exposeInMainWorld('pconairDirector', {
  listOffices: (): Promise<DirectorOfficeSnapshot[]> => ipcRenderer.invoke('pconair:director:list-offices'),

  fireAction: (officeId: string, action: string, body?: Record<string, unknown>): Promise<DirectorActionResult> =>
    ipcRenderer.invoke('pconair:director:fire-action', { officeId, action, body: body ?? {} }),

  onOfficeStatus: (cb: (officeId: string, status: DirectorOfficeSnapshot['status']) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { officeId: string; status: DirectorOfficeSnapshot['status'] }) =>
      cb(payload.officeId, payload.status);
    ipcRenderer.on('pconair:director:office-status', listener);
    return () => ipcRenderer.removeListener('pconair:director:office-status', listener);
  },

  onOfficeState: (cb: (officeId: string, state: unknown) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { officeId: string; state: unknown }) =>
      cb(payload.officeId, payload.state);
    ipcRenderer.on('pconair:director:office-state', listener);
    return () => ipcRenderer.removeListener('pconair:director:office-state', listener);
  },
});
