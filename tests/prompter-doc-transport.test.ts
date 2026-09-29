import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, electronModule, fakeSessionFor } from './setup/electron-mock';
import { createElectronDocTransport } from '../src/main/prompter/doc-transport';

// Top-level-import + `beforeEach(electronMock.reset())` pattern (Task 2/3/4
// finding, see tests/electron-chrome-windows.test.ts) rather than per-test
// `vi.resetModules()`. `createElectronDocTransport` holds no module-level
// state, so a fresh module instance per test buys nothing here.
beforeEach(() => {
  electronMock.reset();
  vi.unstubAllGlobals();
  // `electronMock.reset()` only clears the recorder arrays, not a
  // `mockImplementation` a previous test installed on this shared `vi.fn` --
  // restore the electron-mock.ts default (record + fresh session per call)
  // so each test starts from the same baseline and only overrides what it
  // needs to.
  electronModule.session.fromPartition.mockImplementation((p: string) => {
    electronMock.partitionsRequested.push(p);
    return fakeSessionFor(p);
  });
});

// The plan's draft assumed `createElectronDocTransport()` returns an object
// with a `.fetchDoc` method, and that this file itself rejects a
// non-Google-Docs URL. Neither holds against the real source:
// `createElectronDocTransport()` returns the `DocTransport` function
// directly (`(url, init) => Promise<DocResponse>`), and URL validation
// (`GOOGLE_DOC_PATTERN`) lives entirely in `doc-source.ts` -- this adapter
// fetches whatever URL it is handed, unconditionally. What it actually does
// is choose between the signed-in Slides session and a bare fetch, so that's
// what these tests characterize.
const GOOGLE_SLIDES_PARTITION = 'persist:google-slides';
const DOC_URL = 'https://docs.google.com/document/d/abc123/export?format=txt';

describe('prompter doc transport', () => {
  it('fetches through the signed-in Google partition when a session cookie is present', async () => {
    const googleSession = fakeSessionFor(GOOGLE_SLIDES_PARTITION);
    googleSession.cookies.get.mockResolvedValue([{ name: 'SID', value: 'x' }]);
    electronModule.session.fromPartition.mockImplementation((p: string) => {
      electronMock.partitionsRequested.push(p);
      return googleSession;
    });

    const transport = createElectronDocTransport();
    const controller = new AbortController();
    await transport(DOC_URL, { signal: controller.signal });

    expect(googleSession.cookies.get).toHaveBeenCalledWith({ domain: '.google.com' });
    expect(electronMock.partitionsRequested).toEqual([GOOGLE_SLIDES_PARTITION, GOOGLE_SLIDES_PARTITION]);
    expect(googleSession.fetch).toHaveBeenCalledWith(DOC_URL, {
      credentials: 'include',
      signal: controller.signal,
    });
  });

  it('falls back to a bare fetch when there is no Google session cookie', async () => {
    // Default `fromPartition` mock resolves `cookies.get()` to `[]`.
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const transport = createElectronDocTransport();
    const controller = new AbortController();
    const res = await transport(DOC_URL, { signal: controller.signal });

    // Only the cookie check touches the partition -- no session-based fetch.
    expect(electronMock.partitionsRequested).toEqual([GOOGLE_SLIDES_PARTITION]);
    expect(fetchSpy).toHaveBeenCalledWith(DOC_URL, { signal: controller.signal });
    expect(res).toEqual({ ok: true, status: 200 });
  });

  it('falls back to a bare fetch when the signed-in session fetch itself fails', async () => {
    const googleSession = fakeSessionFor(GOOGLE_SLIDES_PARTITION);
    googleSession.cookies.get.mockResolvedValue([{ name: 'SSID', value: 'y' }]);
    googleSession.fetch.mockRejectedValue(new Error('session fetch failed'));
    electronModule.session.fromPartition.mockImplementation((p: string) => {
      electronMock.partitionsRequested.push(p);
      return googleSession;
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchSpy);

    const transport = createElectronDocTransport();
    const controller = new AbortController();
    const res = await transport(DOC_URL, { signal: controller.signal });

    expect(googleSession.fetch).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(DOC_URL, { signal: controller.signal });
    expect(res).toEqual({ ok: true, status: 200 });
  });
});
