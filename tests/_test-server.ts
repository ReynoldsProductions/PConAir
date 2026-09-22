import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { createServer } from '../src/main/server';
import { createL3CueStore } from '../src/main/l3/cue-store';
import { createL3ThemeStore } from '../src/main/l3/theme-store';
import { createL3LogoStore } from '../src/main/l3/logo-store';
import { createActionDispatcher } from '../src/main/action-dispatch';
import { createMediaLibraryStore } from '../src/main/media-library/item-store';
import { createSlideshowEngine } from '../src/main/media-library/slideshow';
import { createAuthManager } from '../src/main/auth';
import { createPresetsStore } from '../src/main/presets';
import { createScriptDocsStore } from '../src/main/prompter/script-docs';
import type { DocFetchResult } from '../src/main/prompter/doc-source';
import { bootstrapProfiles, syncActiveProfileUrlPresets, syncActiveProfileScriptDocs, getActiveMarker } from '../src/main/profiles/bootstrap';
import { profileRuntimeStatePath } from '../src/main/profiles/paths';
import { wireRuntimePersistence } from '../src/main/runtime-persistence';
import type { StateStore } from '../src/main/state';

export interface FullServerTestOpts {
  store: StateStore;
  operatorPin: string;
  adminPin: string;
  operatorSessionMs?: number;
  adminSessionMs?: number;
  port?: number;
  mediaLibraryRoot?: string;
  trustForwardedFor?: boolean;
  getTunnelPinHash?: () => string | null;
  startTunnel?: () => void;
  stopTunnel?: () => void;
  saveTunnelSettings?: (patch: Record<string, unknown>) => void;
  packagesRoot?: string | string[];
  /**
   * Fetch stub for the data source poller (spec 20). Defaults to a stub that
   * always rejects, so a test that forgets to pass one gets a loud, obvious
   * failure instead of a silent real network call.
   */
  dataSourceFetchImpl?: typeof fetch;
  graphicsRoot?: string;
  runtimeRoot?: string;
  stageTimer?: import('../src/main/routes/index').RouteServices['stageTimer'];
  getPrompterHost?: () => string;
  isPrompterEnabled?: () => boolean;
  savePrompterSettings?: (patch: { host?: string; enabled?: boolean }) => void;
  prompterWindow?: import('../src/main/routes/index').RouteServices['prompterWindow'];
  /**
   * Fetch stub for the Google Doc source (design doc section 5). Defaults to
   * a stub that always rejects, matching `dataSourceFetchImpl` — a test that
   * forgets to pass one gets a loud, obvious failure instead of a silent
   * real network call to Google Docs.
   */
  fetchDoc?: (docId: string) => Promise<DocFetchResult>;
  /** Ad-hoc L3 PNG render stub; omitted means the export route reports 501. */
  renderAdHocCard?: (input: {
    name: string;
    title?: string | null;
    subtitle?: string | null;
    theme?: string | null;
    logoDataUrl?: string | null;
    side?: 'left' | 'right' | null;
  }) => Promise<Buffer>;
}

export function createFullServer(opts: FullServerTestOpts) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `pconair-${randomUUID()}-`));
  const boot = bootstrapProfiles(userData, {
    operatorPin: opts.operatorPin,
    adminPin: opts.adminPin,
  });

  const auth = createAuthManager({
    operatorPinHash: boot.profile.operatorPinHash,
    adminPinHash: boot.profile.adminPinHash,
    operatorSessionMs: opts.operatorSessionMs ?? boot.profile.appPreferences.operatorSessionDurationMinutes * 60 * 1000,
    adminSessionMs: opts.adminSessionMs ?? boot.profile.appPreferences.adminSessionDurationMinutes * 60 * 1000,
    maxFailures: 5,
    failureWindowMs: 5 * 60 * 1000,
    lockoutMs: 5 * 60 * 1000,
  });

  let markRuntimeFlush: () => void = () => {};
  const chain = () => {
    markRuntimeFlush();
    const id = getActiveMarker(boot.paths)?.id ?? boot.activeId;
    syncActiveProfileUrlPresets(boot.paths, id, presets.list());
  };
  const scriptDocsChain = () => {
    const id = getActiveMarker(boot.paths)?.id ?? boot.activeId;
    syncActiveProfileScriptDocs(boot.paths, id, scriptDocs.list());
  };

  const presets = createPresetsStore(chain);
  presets.replaceAll(boot.profile.urlPresets);
  const scriptDocs = createScriptDocsStore(scriptDocsChain);
  scriptDocs.replaceAll(boot.profile.scriptDocs);
  const l3Cues = createL3CueStore(chain);

  const persistPath = profileRuntimeStatePath(boot.paths, boot.activeId);
  markRuntimeFlush = wireRuntimePersistence(persistPath, { presets, cues: l3Cues }).markDirty;

  const mlRoot = opts.mediaLibraryRoot ?? path.join(userData, 'media-library');
  if (!opts.mediaLibraryRoot) fs.mkdirSync(mlRoot, { recursive: true });
  const mediaLibrary = createMediaLibraryStore({ rootDir: mlRoot });

  const l3FilesRoot = path.join(userData, 'still-store');
  fs.mkdirSync(l3FilesRoot, { recursive: true });
  const l3ThemeStore = createL3ThemeStore({ l3FilesRoot });
  const l3Logos = createL3LogoStore({ l3FilesRoot });

  const slideshow = createSlideshowEngine({ store: opts.store, media: mediaLibrary });

  // Set once createServer() below constructs the transport engine alongside
  // the package hub — see src/main/index.ts's identical wiring and
  // action-dispatch.ts's getTransportEngine doc for why this is a live
  // binding read lazily rather than a value passed at construction time.
  let transportEngineRef: import('../src/main/packages/transport').TransportEngine | null = null;

  const dispatchAction = createActionDispatcher({
    store: opts.store,
    auth,
    presets,
    cues: l3Cues,
    logos: l3Logos,
    media: mediaLibrary,
    slideshow,
    getPrompterHost: opts.getPrompterHost,
    isPrompterEnabled: opts.isPrompterEnabled,
    getTransportEngine: () => transportEngineRef,
    scriptDocsStore: scriptDocs,
    fetchDoc: opts.fetchDoc,
  });

  const server = createServer({
    store: opts.store,
    auth,
    presets,
    l3Cues,
    l3ThemeStore,
    l3Logos,
    l3FilesRoot,
    mediaLibrary,
    slideshow,
    dispatchAction,
    port: opts.port,
    profilePaths: boot.paths,
    getActiveProfileId: () => getActiveMarker(boot.paths)?.id ?? boot.activeId,
    trustForwardedFor: opts.trustForwardedFor,
    getTunnelPinHash: opts.getTunnelPinHash,
    startTunnel: opts.startTunnel,
    stopTunnel: opts.stopTunnel,
    saveTunnelSettings: opts.saveTunnelSettings,
    packagesRoot: opts.packagesRoot,
    // Never let a test hit the real network through the data source poller —
    // see the ServerDeps doc comment on dataSourceFetchImpl.
    dataSourceFetchImpl:
      opts.dataSourceFetchImpl ??
      (async () => {
        throw new Error(
          'dataSourceFetchImpl was not stubbed for this test — a data source poll would otherwise hit the real network. ' +
            'Pass dataSourceFetchImpl to createFullServer().'
        );
      }),
    graphicsRoot: opts.graphicsRoot,
    // Default on: every package page depends on the runtime being served.
    runtimeRoot: opts.runtimeRoot ?? path.join(process.cwd(), 'src', 'runtime'),
    stageTimer: opts.stageTimer,
    getPrompterHost: opts.getPrompterHost,
    isPrompterEnabled: opts.isPrompterEnabled,
    savePrompterSettings: opts.savePrompterSettings,
    prompterWindow: opts.prompterWindow,
    scriptDocsStore: scriptDocs,
    fetchDoc: opts.fetchDoc,
    renderAdHocCard: opts.renderAdHocCard,
  });
  transportEngineRef = server.transportEngine ?? null;

  return {
    ...server,
    presets,
    scriptDocs,
    l3Cues,
    l3ThemeStore,
    l3Logos,
    l3FilesRoot,
    auth,
    mediaLibrary,
    profilePaths: boot.paths,
    activeProfileId: boot.activeId,
  };
}
