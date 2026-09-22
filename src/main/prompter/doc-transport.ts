import { session } from 'electron';
import type { DocResponse, DocTransport } from './doc-source';

/**
 * Real `DocTransport` for `fetchDocText`, per design section 1 / decision #1
 * ("session-first fetch, anonymous fallback"). Electron-specific — this file
 * is deliberately the only thing in the doc-fetching path that imports
 * `electron`, so `doc-source.ts` stays unit-testable and this stays a thin,
 * readable (if untestable outside a running app) adapter.
 *
 * Reuses the same session partition Slides mode signs in on
 * (`persist:google-slides`, see `src/main/slides/window-manager.ts`), so a
 * producer who has already signed in for Slides gets private-doc access here
 * for free — and the same cookie sniff (`SID`/`SSID`/`SAPISID`) used by
 * `getGoogleAuthState` decides whether there is a session worth trying.
 */
const GOOGLE_SLIDES_PARTITION = 'persist:google-slides';

async function hasGoogleSessionCookie(): Promise<boolean> {
  const googleSession = session.fromPartition(GOOGLE_SLIDES_PARTITION);
  const cookies = await googleSession.cookies.get({ domain: '.google.com' });
  return cookies.some((c) => c.name === 'SID' || c.name === 'SSID' || c.name === 'SAPISID');
}

async function anonymousFetch(url: string, init: { signal: AbortSignal }): Promise<DocResponse> {
  return fetch(url, { signal: init.signal });
}

/**
 * Tries the signed-in session first when a Google session cookie is present
 * (works for private/org docs), and falls back to a bare, cookie-less fetch
 * — either because there is no session to try, or because the session-based
 * attempt itself failed — which is what makes link-shared docs work even
 * when nobody has signed in to Slides mode.
 */
export function createElectronDocTransport(): DocTransport {
  return async (url, init) => {
    const signedIn = await hasGoogleSessionCookie();
    if (!signedIn) {
      return anonymousFetch(url, init);
    }
    try {
      // Issued from the Slides sign-in's own session object (rather than the
      // top-level `net.fetch`, which only ever uses Electron's *default*
      // session) so `credentials: 'include'` sends that session's cookies —
      // the actual mechanism `net.fetch`'s docs point to as `session.fetch`.
      const res = await session.fromPartition(GOOGLE_SLIDES_PARTITION).fetch(url, {
        credentials: 'include',
        signal: init.signal,
      });
      return res as unknown as DocResponse;
    } catch {
      return anonymousFetch(url, init);
    }
  };
}
