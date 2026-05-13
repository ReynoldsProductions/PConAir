const fetchDefaults: RequestInit = { credentials: 'include' };

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, fetchDefaults);
  const data = await res.json() as T | { error: { code: string; message: string } };
  if (!res.ok) {
    const msg = (data as { error: { message: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    ...fetchDefaults,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as T | { error: { code: string; message: string } };
  if (!res.ok) {
    const msg = (data as { error: { message: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** Cue row from GET /api/l3/cues (subset used by operator UI). */
export interface L3CueListItem {
  id: string;
  name: string;
  title: string;
}

export const loadDeck    = (deckUrl: string)           => apiPost('/api/slides/load',  { deckUrl });
export const slideNext   = ()                          => apiPost('/api/slides/next');
export const slidePrev   = ()                          => apiPost('/api/slides/prev');
export const slideGoto   = (slideIndex: number)        => apiPost('/api/slides/goto',  { slideIndex });
export const slideReload = ()                          => apiPost('/api/slides/reload');
export const switchAB    = (instance: 'A' | 'B')      => apiPost('/api/ab/switch',     { instance });
export const setMode     = (mode: string)              => apiPost('/api/mode',         { mode });

export const loadUrl = (url: string, display?: string) =>
  apiPost<unknown>('/api/url', display ? { url, display } : { url });

export const urlReload = (instance?: 'A' | 'B') =>
  apiPost<unknown>('/api/url/reload', instance ? { instance } : {});

export const l3ListCues = () => apiGet<{ cues: L3CueListItem[] }>('/api/l3/cues');

export const l3Take = (body: { cueId?: string; name?: string; title?: string }) =>
  apiPost<unknown>('/api/l3/take', body);

export const l3Clear = () => apiPost<unknown>('/api/l3/clear');

export const l3Stacking = (enabled: boolean) =>
  apiPost<unknown>('/api/l3/stacking', { enabled });

export interface MediaLibraryListItem {
  id: string;
  displayName: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  width?: number;
  height?: number;
  hasTransparency?: boolean;
  uploadedAt: number;
}

export const mediaLibraryList = () => apiGet<{ items: MediaLibraryListItem[] }>('/api/media-library');

export const mediaLibraryTake = (itemId: string) =>
  apiPost<unknown>('/api/media-library/take', { itemId });

export const mediaLibraryClear = () => apiPost<unknown>('/api/media-library/clear');

export const fetchActiveProfile = () =>
  apiGet<{
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    appPreferences?: { operatorTheme?: 'light' | 'dark' };
  }>('/api/profiles/active');

export const reloadInstance = (instance: 'A' | 'B', timeout?: number) =>
  apiPost<unknown>('/api/reload-instance', timeout ? { instance, timeout } : { instance });

export async function panicAction(action: 'toggle' | 'on' | 'off' = 'toggle'): Promise<{
  panicActive: boolean;
  slate: { type: string; value: string };
  message: string;
}> {
  return apiPost('/api/panic', { action });
}

export const fetchServerInfo = () =>
  apiGet<{
    machineName: string;
    port: number;
    networkAddresses: Array<{ name: string; address: string; family: string }>;
    operatorUrls: string[];
    adminUrls: string[];
    companionUrls: string[];
    crashDumpsPath: string;
    uptime: number;
  }>('/api/server-info');

export const fetchSlidesNotes = () =>
  apiGet<{ notes: string | null; slideIndex: number | null }>('/api/slides/notes');

export interface UrlPresetItem {
  id: string;
  name: string;
  url: string;
}

export const fetchPresets = () =>
  apiGet<{ presets: UrlPresetItem[] }>('/api/presets');
