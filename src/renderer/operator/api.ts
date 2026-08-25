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

export async function apiPost<T>(path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const res = await fetch(path, {
    ...fetchDefaults,
    method,
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
  subtitle: string | null;
}

export const getGoogleAuthState = () =>
  apiGet<{ loggedIn: boolean; email: string | null }>('/api/slides/auth');
export const openGoogleAuth = () =>
  apiPost<{ opened: boolean }>('/api/slides/auth/open');

export const loadDeck    = (deckUrl: string)           => apiPost('/api/slides/load',  { deckUrl });
export const slideNext   = ()                          => apiPost('/api/slides/next');
export const slidePrev   = ()                          => apiPost('/api/slides/prev');
export const slideGoto   = (slideIndex: number)        => apiPost('/api/slides/goto',  { slideIndex });
export const slideReload = ()                          => apiPost('/api/slides/reload');
export const switchAB    = (instance: 'A' | 'B')      => apiPost('/api/ab/switch',     { instance });
export const setMode     = (mode: string)              => apiPost('/api/mode',         { mode });

export const loadUrl = (url: string, display?: string) =>
  apiPost<unknown>('/api/url', display ? { url, display } : { url });

export const listDisplays = () =>
  apiGet<{ displays: { id: string; name: string; isPrimary: boolean }[] }>('/api/displays');

export const urlReload = (instance?: 'A' | 'B') =>
  apiPost<unknown>('/api/url/reload', instance ? { instance } : {});

export const l3ListCues = () => apiGet<{ cues: L3CueListItem[] }>('/api/l3/cues');

export type LowerThirdSide = 'left' | 'right';

export const lowerThirdApply = (body: {
  side: LowerThirdSide;
  cueId?: string;
  name?: string;
  title?: string;
  subtitle?: string;
  theme?: string;
  fadeEnabled?: boolean;
  fadeMs?: number;
  animationStyle?: string;
  logoEnabled?: boolean;
  logoAssetId?: string | null;
}) => apiPost<unknown>('/api/action', { action_id: 'lower_third_apply', params: body });

export const lowerThirdHide = (side: LowerThirdSide) =>
  apiPost<unknown>('/api/action', { action_id: 'lower_third_hide', params: { side } });

export const l3CreateCue = (body: { name: string; title?: string; subtitle?: string; themeId?: string }) =>
  apiPost<{ id: string }>('/api/l3/cues', body);

export const l3UpdateCue = (
  cueId: string,
  body: { name?: string; title?: string; subtitle?: string; themeId?: string }
) => apiPost<unknown>(`/api/l3/cues/${encodeURIComponent(cueId)}`, body, 'PUT');

async function apiPostFormData<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(path, { credentials: 'include', method: 'POST', body: form });
  const data = (await res.json()) as T | { error: { code: string; message: string } };
  if (!res.ok) {
    const msg = (data as { error: { message: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

export const l3ImportCsv = (file: File) => {
  const form = new FormData();
  form.append('csvFile', file);
  return apiPostFormData<{ imported: number; skipped: number; warnings: string[] }>('/api/l3/cues/import', form);
};

export interface L3LogoAsset {
  id: string;
  filename: string;
  format: string;
  uploadedAt: number;
}

export const l3ListLogos = () => apiGet<{ logos: L3LogoAsset[] }>('/api/l3/logos');

export const l3UploadLogo = (file: File) => {
  const form = new FormData();
  form.append('logoFile', file);
  return apiPostFormData<L3LogoAsset>('/api/l3/logos', form);
};

export const l3DeleteLogo = async (id: string): Promise<void> => {
  const res = await fetch(`/api/l3/logos/${encodeURIComponent(id)}`, { credentials: 'include', method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
};

/** Ad-hoc PNG export of whatever is currently composed — triggers a browser download. */
export async function l3ExportPng(body: {
  name: string;
  title?: string;
  subtitle?: string;
  theme?: string;
  logoAssetId?: string | null;
}): Promise<void> {
  const res = await fetch('/api/l3/export', {
    credentials: 'include',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      if (data.error?.message) msg = data.error.message;
    } catch { /* body wasn't JSON */ }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(body.name || 'lower-third').replace(/[^\w\s-]/g, '_')}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

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
