export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
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
