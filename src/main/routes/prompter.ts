import { Router, Request, Response, NextFunction } from 'express';
import type { StateStore } from '../state';
import type { AuthManager } from '../auth';
import {
  PROMPTER_TEXT_ALIGNS,
  makePrompterState,
  type DocErrorCode,
  type PrompterState,
  type PrompterTextAlign,
} from '../../shared/types';
import { requireOperator, requireAdmin } from './middleware';
import { PROMPTER_PAGE_HTML, PROMPTER_CSP } from '../prompter/page';
import { forwardToExternalPrompter, type ForwardResult } from '../prompter/forward';
import { extractDocId, type DocFetchResult } from '../prompter/doc-source';
import { ScriptDocValidationError, type ScriptDocsStore } from '../prompter/script-docs';
import {
  positionAt,
  start,
  stop,
  toggle,
  rewind,
  seek,
  nudgePosition,
  scrollLines,
  setSpeed,
  nudgeSpeed,
  setFontSize,
  nudgeFontSize,
  setLineHeight,
  setScript,
  setMirror,
  setSidePadding,
  setTextAlign,
  nudgeSidePadding,
  setMarkerPosition,
  nudgeMarkerPosition,
  setMarkerVisible,
  SPEED_STEP,
  FONT_SIZE_STEP,
} from '../prompter/transport';

export interface PrompterRouterDeps {
  store: StateStore;
  auth: AuthManager;
  /** Base URL of an optional third-party prompter service ('' when none). */
  getPrompterHost: () => string;
  /** Whether commands should also be forwarded to that service. */
  isPrompterEnabled: () => boolean;
  savePrompterSettings: (patch: { host?: string; enabled?: boolean }) => void;
  /** Fullscreen prompter output window (Electron main only); absent in tests. */
  prompterWindow?: {
    open: (displayId: string | null) => Promise<void>;
    close: () => void;
    status: () => { open: boolean; displayId: string | null };
  };
  /** Saved Google Doc script library (`script-docs.ts`). Pure JS, no Electron dependency — always available. */
  scriptDocsStore: ScriptDocsStore;
  /** `fetchDocText` with a real (or, in tests, fake) `DocTransport` already bound. */
  fetchDoc: (docId: string) => Promise<DocFetchResult>;
}

/**
 * The subset of prompter state the talent display needs — no service config.
 *
 * `doc` is deliberately omitted entirely, not just `doc.staged`: the talent
 * display has no use for any part of the Google Doc source, and every field
 * left out here is a field that can never leak un-taken copy, present or
 * future. See design doc section 2 / `PrompterDocState`'s doc comment.
 */
function viewState(s: PrompterState) {
  return {
    script: s.script,
    scrolling: s.scrolling,
    speed: s.speed,
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    offset: s.offset,
    startedAt: s.startedAt,
    mirrorX: s.mirrorX,
    mirrorY: s.mirrorY,
    sidePadding: s.sidePadding,
    textAlign: s.textAlign,
    markerPosition: s.markerPosition,
    markerVisible: s.markerVisible,
  };
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: { code: 'INVALID_MODE', message } });
}

/** 400 for a bad request that never reached the network; 422 for a fetch that succeeded but the content is unusable; 502 for anything that failed to reach or read Google Docs. */
function docErrorStatus(code: DocErrorCode): number {
  switch (code) {
    case 'INVALID_DOC_URL':
      return 400;
    case 'DOC_EMPTY':
    case 'DOC_TOO_LARGE':
      return 422;
    case 'DOC_UNREACHABLE':
    case 'DOC_NOT_READABLE':
      return 502;
    default:
      return 502;
  }
}

/**
 * Operator auth for the one route the Companion module polls cookie-less: a
 * valid operator/admin session cookie, OR the `operator_pin` query param
 * verified against the operator PIN. Same fallback `packages.ts` gives its
 * transport routes and `POST /api/action` already gives every other
 * Companion action, because Companion never carries a session cookie.
 * `requireOperator()` (middleware.ts) is cookie-only, which is right for the
 * admin web GUI's other operator-gated routes but would make this route
 * uncallable from Companion's library dropdown/preset refresh.
 */
function requireOperatorOrPin(auth: AuthManager) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const pinQ = typeof req.query.operator_pin === 'string' ? req.query.operator_pin : undefined;
    const opCookie = req.cookies?.pconair_operator_session as string | undefined;
    const admCookie = req.cookies?.pconair_admin_session as string | undefined;
    const sid = opCookie ?? admCookie;
    let authed = Boolean(sid && auth.getSession(sid));
    if (!authed && pinQ) {
      authed = await auth.verifyOperatorPin(pinQ);
    }
    if (!authed) {
      res.status(401).json({ error: { code: 'AUTH_REQUIRED', message: 'Authentication required' } });
      return;
    }
    next();
  };
}

export function createPrompterRouter(deps: PrompterRouterDeps): Router {
  const { store, auth, getPrompterHost, isPrompterEnabled, savePrompterSettings, prompterWindow, scriptDocsStore, fetchDoc } = deps;
  const router = Router();
  const opGuard = requireOperator(auth);
  const adminGuard = requireAdmin(auth);
  const opOrPinGuard = requireOperatorOrPin(auth);

  function current(): PrompterState {
    return store.getState().prompter;
  }

  /**
   * Apply a transport op locally — that is what the built-in display follows —
   * then mirror it to a third-party prompter service if one is configured.
   * A service that is down never blocks the local prompter.
   */
  async function apply(
    next: PrompterState,
    forward: Record<string, unknown> | null,
    res: Response
  ): Promise<void> {
    store.setState({ prompter: next });
    const forwarded: ForwardResult = forward
      ? await forwardToExternalPrompter(
          { host: getPrompterHost(), enabled: isPrompterEnabled() },
          forward
        )
      : 'off';
    res.json({ ok: true, forwarded, prompter: next, position: positionAt(next, Date.now()) });
  }

  // ---- talent-facing display -------------------------------------------
  // Public on the LAN, like the render pages: the people reading off it are
  // on a tablet or a glass rig, not signing in with the operator PIN. Remote
  // access still goes through the tunnel PIN gate.
  router.get('/prompter', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', PROMPTER_CSP);
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.send(PROMPTER_PAGE_HTML);
  });

  /** Hydration snapshot for the display, plus the server clock it derives its position from. */
  router.get('/api/prompter/view', (_req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ prompter: viewState(current()), serverNow: Date.now() });
  });

  // ---- operator control -------------------------------------------------
  router.get('/api/prompter/status', opGuard, async (_req: Request, res: Response) => {
    const s = current();
    const host = getPrompterHost();
    let connected = false;
    if (host) {
      try {
        const r = await fetch(`${host}/api/state`, { signal: AbortSignal.timeout(3000) });
        connected = r.ok;
      } catch {
        connected = false;
      }
    }
    res.json({
      prompter: s,
      position: positionAt(s, Date.now()),
      serverNow: Date.now(),
      external: { configured: host !== '', enabled: isPrompterEnabled(), connected },
      window: prompterWindow ? prompterWindow.status() : { open: false, displayId: null, available: false },
    });
  });

  /** Open or close the fullscreen prompter output on one of this machine's monitors. */
  router.post('/api/prompter/window', opGuard, async (req: Request, res: Response) => {
    if (!prompterWindow) {
      res.status(501).json({
        error: { code: 'NOT_IMPLEMENTED', message: 'Prompter output windows are only available in the desktop app' },
      });
      return;
    }
    const { open, displayId } = req.body as { open?: unknown; displayId?: unknown };
    if (typeof open !== 'boolean') {
      badRequest(res, 'open must be a boolean');
      return;
    }
    if (!open) {
      prompterWindow.close();
      res.json({ ok: true, window: prompterWindow.status() });
      return;
    }
    const target = typeof displayId === 'string' && displayId !== '' ? displayId : null;
    try {
      await prompterWindow.open(target);
    } catch {
      res.status(502).json({ error: { code: 'INVALID_MODE', message: 'Could not open the prompter output window' } });
      return;
    }
    res.json({ ok: true, window: prompterWindow.status() });
  });

  router.post('/api/prompter/start', opGuard, async (_req: Request, res: Response) => {
    await apply(start(current(), Date.now()), { scrolling: true }, res);
  });

  router.post('/api/prompter/stop', opGuard, async (_req: Request, res: Response) => {
    await apply(stop(current(), Date.now()), { scrolling: false }, res);
  });

  router.post('/api/prompter/toggle', opGuard, async (_req: Request, res: Response) => {
    const next = toggle(current(), Date.now());
    await apply(next, { scrolling: next.scrolling }, res);
  });

  router.post('/api/prompter/rewind', opGuard, async (_req: Request, res: Response) => {
    await apply(rewind(current(), Date.now()), null, res);
  });

  /** Absolute px, a px delta, or a delta in whole lines of the current type. */
  router.post('/api/prompter/position', opGuard, async (req: Request, res: Response) => {
    const { position, delta, lines } = req.body as { position?: unknown; delta?: unknown; lines?: unknown };
    const now = Date.now();
    if (typeof position === 'number' && Number.isFinite(position)) {
      await apply(seek(current(), position, now), null, res);
      return;
    }
    if (typeof delta === 'number' && Number.isFinite(delta)) {
      await apply(nudgePosition(current(), delta, now), null, res);
      return;
    }
    if (typeof lines === 'number' && Number.isFinite(lines)) {
      await apply(scrollLines(current(), lines, now), null, res);
      return;
    }
    badRequest(res, 'position, delta, or lines must be a number');
  });

  router.post('/api/prompter/scroll', opGuard, async (req: Request, res: Response) => {
    const { direction } = req.body as { direction?: string };
    if (direction !== 'faster' && direction !== 'slower') {
      badRequest(res, 'direction must be "faster" or "slower"');
      return;
    }
    const next = nudgeSpeed(current(), direction === 'faster' ? SPEED_STEP : -SPEED_STEP, Date.now());
    await apply(next, { speed: next.speed }, res);
  });

  router.post('/api/prompter/speed', opGuard, async (req: Request, res: Response) => {
    const { speed } = req.body as { speed?: unknown };
    if (typeof speed !== 'number' || !Number.isFinite(speed)) {
      badRequest(res, 'speed must be a number');
      return;
    }
    const next = setSpeed(current(), speed, Date.now());
    await apply(next, { speed: next.speed }, res);
  });

  router.post('/api/prompter/font-size', opGuard, async (req: Request, res: Response) => {
    const { direction, fontSize } = req.body as { direction?: string; fontSize?: unknown };
    let next: PrompterState;
    if (direction === 'in' || direction === 'out') {
      next = nudgeFontSize(current(), direction === 'in' ? FONT_SIZE_STEP : -FONT_SIZE_STEP);
    } else if (typeof fontSize === 'number' && Number.isFinite(fontSize)) {
      next = setFontSize(current(), fontSize);
    } else {
      badRequest(res, 'direction must be "in" or "out", or fontSize must be a number');
      return;
    }
    await apply(next, { font_size: next.fontSize }, res);
  });

  router.post('/api/prompter/line-height', opGuard, async (req: Request, res: Response) => {
    const { lineHeight } = req.body as { lineHeight?: unknown };
    if (typeof lineHeight !== 'number' || !Number.isFinite(lineHeight)) {
      badRequest(res, 'lineHeight must be a number');
      return;
    }
    await apply(setLineHeight(current(), lineHeight), null, res);
  });

  router.post('/api/prompter/text-align', opGuard, async (req: Request, res: Response) => {
    const { align } = req.body as { align?: unknown };
    if (typeof align !== 'string' || !PROMPTER_TEXT_ALIGNS.includes(align as PrompterTextAlign)) {
      badRequest(res, `align must be one of ${PROMPTER_TEXT_ALIGNS.join(', ')}`);
      return;
    }
    const next = setTextAlign(current(), align as PrompterTextAlign);
    await apply(next, { text_align: next.textAlign }, res);
  });

  /** Absolute vw, or a delta so a button can nudge the margin a step at a time. */
  router.post('/api/prompter/side-padding', opGuard, async (req: Request, res: Response) => {
    const { sidePadding, delta } = req.body as { sidePadding?: unknown; delta?: unknown };
    const hasValue = typeof sidePadding === 'number' && Number.isFinite(sidePadding);
    const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
    if (!hasValue && !hasDelta) {
      badRequest(res, 'sidePadding or delta must be a number');
      return;
    }
    const next = hasValue
      ? setSidePadding(current(), sidePadding as number)
      : nudgeSidePadding(current(), delta as number);
    await apply(next, { side_padding: next.sidePadding }, res);
  });

  /**
   * Position and visibility share one endpoint, the way `/mirror` takes either
   * axis, so a single button can move the marker and another can hide it.
   */
  router.post('/api/prompter/marker', opGuard, async (req: Request, res: Response) => {
    const { position, delta, visible } = req.body as {
      position?: unknown;
      delta?: unknown;
      visible?: unknown;
    };
    const hasPosition = typeof position === 'number' && Number.isFinite(position);
    const hasDelta = typeof delta === 'number' && Number.isFinite(delta);
    const hasVisible = typeof visible === 'boolean';
    if (!hasPosition && !hasDelta && !hasVisible) {
      badRequest(res, 'position or delta must be a number, and/or visible must be a boolean');
      return;
    }

    let next = current();
    if (hasPosition) next = setMarkerPosition(next, position as number);
    else if (hasDelta) next = nudgeMarkerPosition(next, delta as number);
    if (hasVisible) next = setMarkerVisible(next, visible as boolean);

    await apply(next, { marker_position: next.markerPosition, marker_visible: next.markerVisible }, res);
  });

  router.post('/api/prompter/mirror', opGuard, async (req: Request, res: Response) => {
    const { x, y } = req.body as { x?: unknown; y?: unknown };
    if (typeof x !== 'boolean' && typeof y !== 'boolean') {
      badRequest(res, 'x and/or y must be booleans');
      return;
    }
    const axes = {
      ...(typeof x === 'boolean' ? { x } : {}),
      ...(typeof y === 'boolean' ? { y } : {}),
    };
    await apply(setMirror(current(), axes), null, res);
  });

  router.post('/api/prompter/script', opGuard, async (req: Request, res: Response) => {
    const { text } = req.body as { text?: unknown };
    if (typeof text !== 'string') {
      badRequest(res, 'text must be a string');
      return;
    }
    await apply(setScript(current(), text, Date.now()), { script: text }, res);
  });

  // ---- Google Doc script source ------------------------------------------
  // See design doc section 5 ("Routes") and "Error handling". Every route
  // here must preserve the safety invariant: a failed load/refresh, or a
  // staged-but-untaken refresh, never touches `script` or `doc.loadedHash`.

  function patchDoc(fields: Partial<PrompterState['doc']>): PrompterState {
    const next: PrompterState = { ...current(), doc: { ...current().doc, ...fields } };
    store.setState({ prompter: next });
    return next;
  }

  function sendDocError(res: Response, outcome: Extract<DocFetchResult, { ok: false }>): void {
    res.status(docErrorStatus(outcome.code)).json({ error: { code: outcome.code, message: outcome.message } });
  }

  router.post('/api/prompter/doc/load', opGuard, async (req: Request, res: Response) => {
    const { url, presetId } = req.body as { url?: unknown; presetId?: unknown };

    let docId: string | null = null;
    let name: string | null = null;
    let sourceUrl: string | null = null;

    if (typeof presetId === 'string' && presetId) {
      const entry = scriptDocsStore.findById(presetId);
      if (!entry) {
        res.status(400).json({ error: { code: 'INVALID_DOC_URL', message: `No saved script matches id '${presetId}'.` } });
        return;
      }
      docId = extractDocId(entry.docUrl);
      name = entry.name;
      sourceUrl = entry.docUrl;
    } else if (typeof url === 'string' && url) {
      docId = extractDocId(url);
      sourceUrl = url;
    }

    if (!docId || !sourceUrl) {
      res.status(400).json({ error: { code: 'INVALID_DOC_URL', message: 'A url or presetId resolving to a Google Docs document is required.' } });
      return;
    }

    const outcome = await fetchDoc(docId);
    if (!outcome.ok) {
      patchDoc({ status: 'error', error: { code: outcome.code, message: outcome.message } });
      sendDocError(res, outcome);
      return;
    }

    const now = Date.now();
    const next: PrompterState = {
      ...setScript(current(), outcome.text, now),
      doc: {
        ...current().doc,
        url: sourceUrl,
        docId,
        name,
        loadedAt: now,
        loadedHash: outcome.hash,
        staged: null,
        status: 'ready',
        error: null,
      },
    };
    await apply(next, { script: outcome.text }, res);
  });

  router.post('/api/prompter/doc/refresh', opGuard, async (_req: Request, res: Response) => {
    const doc = current().doc;
    if (!doc.docId) {
      res.status(409).json({ error: { code: 'NO_DOC_CONFIGURED', message: 'No Google Doc is loaded. Load one before refreshing.' } });
      return;
    }

    const outcome = await fetchDoc(doc.docId);
    if (!outcome.ok) {
      const next = patchDoc({ status: 'error', error: { code: outcome.code, message: outcome.message } });
      res.status(docErrorStatus(outcome.code)).json({ error: { code: outcome.code, message: outcome.message }, prompter: next });
      return;
    }

    const now = Date.now();
    const next = patchDoc({
      staged: { text: outcome.text, hash: outcome.hash, words: outcome.words, fetchedAt: now },
      status: 'ready',
      error: null,
    });
    res.json({ ok: true, prompter: next });
  });

  router.post('/api/prompter/doc/take', opGuard, async (_req: Request, res: Response) => {
    const staged = current().doc.staged;
    if (!staged) {
      res.status(409).json({ error: { code: 'NOTHING_STAGED', message: 'No refreshed text is staged to take.' } });
      return;
    }

    const now = Date.now();
    const next: PrompterState = {
      ...setScript(current(), staged.text, now),
      doc: {
        ...current().doc,
        loadedHash: staged.hash,
        loadedAt: now,
        staged: null,
      },
    };
    await apply(next, { script: staged.text }, res);
  });

  router.post('/api/prompter/doc/clear', opGuard, async (_req: Request, res: Response) => {
    // Detaches the source only. The text currently on the glass (`script`)
    // is left exactly as it is — this is not a Take-back or a blank.
    const next = patchDoc(makePrompterState().doc);
    res.json({ ok: true, prompter: next });
  });

  router.get('/api/prompter/docs', opOrPinGuard, (_req: Request, res: Response) => {
    res.json({ docs: scriptDocsStore.list() });
  });

  router.post('/api/prompter/docs', adminGuard, (req: Request, res: Response) => {
    const { name, docUrl, description } = req.body as { name?: unknown; docUrl?: unknown; description?: unknown };
    try {
      const created = scriptDocsStore.create({
        name: name as string,
        docUrl: docUrl as string,
        description: typeof description === 'string' ? description : '',
      });
      res.status(201).json(created);
    } catch (err) {
      if (err instanceof ScriptDocValidationError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
        return;
      }
      throw err;
    }
  });

  router.patch('/api/prompter/docs/:id', adminGuard, (req: Request, res: Response) => {
    const { id } = req.params;
    const { name, docUrl, description } = req.body as { name?: unknown; docUrl?: unknown; description?: unknown };
    try {
      const updated = scriptDocsStore.update(id, {
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof docUrl === 'string' ? { docUrl } : {}),
        ...(typeof description === 'string' ? { description } : {}),
      });
      if (!updated) {
        res.status(404).json({ error: { code: 'SCRIPT_DOC_NOT_FOUND', message: `No saved script matches id '${id}'.` } });
        return;
      }
      res.json(updated);
    } catch (err) {
      if (err instanceof ScriptDocValidationError) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.message } });
        return;
      }
      throw err;
    }
  });

  router.delete('/api/prompter/docs/:id', adminGuard, (req: Request, res: Response) => {
    const { id } = req.params;
    if (!scriptDocsStore.findById(id)) {
      res.status(404).json({ error: { code: 'SCRIPT_DOC_NOT_FOUND', message: `No saved script matches id '${id}'.` } });
      return;
    }
    scriptDocsStore.remove(id);
    res.status(204).end();
  });

  // ---- admin config -----------------------------------------------------
  router.post('/api/prompter/config', requireAdmin(auth), (req: Request, res: Response) => {
    const { host, enabled } = req.body as { host?: string; enabled?: boolean };
    const patch: { host?: string; enabled?: boolean } = {};
    if (typeof host === 'string') patch.host = host.trim();
    if (typeof enabled === 'boolean') patch.enabled = enabled;
    savePrompterSettings(patch);
    const next: PrompterState = {
      ...current(),
      ...(patch.host !== undefined ? { host: patch.host } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    };
    store.setState({ prompter: next });
    res.json({ ok: true, prompter: next });
  });

  return router;
}
