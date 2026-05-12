import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { createProgramWindow, createOperatorWindow } from './window';
import { createServer } from './server';
import { getStore } from './state';
import { createAuthManager } from './auth';
import { createPresetsStore } from './presets';
import { createSlidesWindowManager } from './slides/window-manager';
import { createUrlWindowManager } from './url/window-manager';
import { createL3CueStore } from './l3/cue-store';
import { createL3PlaylistStore } from './l3/playlist-store';
import { createL3ThemeStore } from './l3/theme-store';
import { createL3WindowManager } from './l3/window-manager';
import { createMediaLibraryStore } from './media-library/item-store';
import { createMediaLibraryWindowManager } from './media-library/window-manager';
import { createActionDispatcher } from './action-dispatch';
import { renderCueToPng } from './l3/cue-renderer';
import { wireRuntimePersistence } from './runtime-persistence';
import { snapshotDisplays } from './displays';
import { bootstrapProfiles, parseProfileCliArg, getActiveMarker, syncActiveProfileUrlPresets, clearIpAllowlistForActiveProfile } from './profiles/bootstrap';
import { profileRuntimeStatePath } from './profiles/paths';
import { parsePconairCli } from './cli-options';

const cli = parsePconairCli(process.argv);
const DEFAULT_PORT = parseInt(process.env.PCONAIR_PORT ?? '8080', 10);
const OPERATOR_PIN = cli.operatorPin ?? process.env.PCONAIR_OPERATOR_PIN ?? '0000';
const ADMIN_PIN = cli.adminPin ?? process.env.PCONAIR_ADMIN_PIN ?? '00000000';

function validatePins(operator: string, admin: string): void {
  if (operator.length < 4) {
    console.error('PCONAIR_OPERATOR_PIN must be at least 4 characters.');
    app.exit(1);
  }
  if (admin.length < 8) {
    console.error('PCONAIR_ADMIN_PIN must be at least 8 characters.');
    app.exit(1);
  }
  if (operator === admin) {
    console.error('PCONAIR_ADMIN_PIN must be different from PCONAIR_OPERATOR_PIN.');
    app.exit(1);
  }
}

let programWindow: BrowserWindow | null = null;

function syncDisplaysToStore(): void {
  const store = getStore();
  store.setState({ displays: snapshotDisplays() });
}

async function main() {
  validatePins(OPERATOR_PIN, ADMIN_PIN);
  const cliProfile = parseProfileCliArg(process.argv);
  const userData = app.getPath('userData');
  if (cli.clearAllowlist) {
    clearIpAllowlistForActiveProfile(userData);
    console.log('[security] IP allowlist cleared for active profile.');
  }
  const boot = bootstrapProfiles(userData, { operatorPin: OPERATOR_PIN, adminPin: ADMIN_PIN }, cliProfile);

  const store = getStore();
  const operatorSessionMs =
    cli.operatorSessionTimeoutSec != null
      ? cli.operatorSessionTimeoutSec * 1000
      : boot.profile.appPreferences.operatorSessionDurationMinutes * 60 * 1000;
  const adminSessionMs =
    cli.adminSessionTimeoutSec != null
      ? cli.adminSessionTimeoutSec * 1000
      : boot.profile.appPreferences.adminSessionDurationMinutes * 60 * 1000;

  const auth = createAuthManager({
    operatorPinHash: boot.profile.operatorPinHash,
    adminPinHash: boot.profile.adminPinHash,
    operatorSessionMs,
    adminSessionMs,
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

  const presets = createPresetsStore(chain);
  presets.replaceAll(boot.profile.urlPresets);
  const l3Cues = createL3CueStore(chain);
  const l3Playlists = createL3PlaylistStore(l3Cues, chain);
  const persistPath = profileRuntimeStatePath(boot.paths, boot.activeId);
  markRuntimeFlush = wireRuntimePersistence(persistPath, { presets, cues: l3Cues, playlists: l3Playlists }).markDirty;

  const mediaLibraryRoot = path.join(app.getPath('userData'), 'media-library');
  const mediaLibrary = createMediaLibraryStore({ rootDir: mediaLibraryRoot });

  const l3FilesRoot = path.join(userData, 'still-store');
  const l3ThemeStore = createL3ThemeStore({ l3FilesRoot });

  const dispatchAction = createActionDispatcher({ store, auth, presets, cues: l3Cues });

  syncDisplaysToStore();
  screen.on('display-added', syncDisplaysToStore);
  screen.on('display-removed', syncDisplaysToStore);
  screen.on('display-metrics-changed', syncDisplaysToStore);

  const slidesManager = createSlidesWindowManager({ store });
  slidesManager.initialize();

  const urlManager = createUrlWindowManager({ store });
  urlManager.initialize();

  const l3Manager = createL3WindowManager({ store });
  l3Manager.initialize();

  const mediaLibraryManager = createMediaLibraryWindowManager({ store, media: mediaLibrary });
  mediaLibraryManager.initialize();

  const server = createServer({
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    mediaLibrary,
    dispatchAction,
    port: DEFAULT_PORT,
    profilePaths: boot.paths,
    getActiveProfileId: () => getActiveMarker(boot.paths)?.id ?? boot.activeId,
    onProfileActivate: () => {
      app.relaunch();
      app.exit(0);
    },
    trustForwardedFor: cli.trustForwardedFor,
    renderManualCue: (cue) => renderCueToPng(cue, l3ThemeStore.getThemeCss(cue.theme)),
  });
  await server.listen();
  console.log(`PC On Air server running on http://localhost:${DEFAULT_PORT}`);

  programWindow = createProgramWindow({ fullscreen: false });
  createOperatorWindow(DEFAULT_PORT);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      programWindow = createProgramWindow({ fullscreen: false });
      createOperatorWindow(DEFAULT_PORT);
    }
  });
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('Failed to start PC On Air:', err);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
