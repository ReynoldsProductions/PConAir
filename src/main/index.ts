import { app, screen, session } from 'electron';
import fs from 'fs';
import path from 'path';
import { createOperatorWindow } from './window';
import { appSettingsPath, loadAppSettings, resolvePort, saveAppSettings } from './app-settings';
import { createTunnelManager } from './tunnel/manager';
import { showQrOverlay, hideQrOverlay } from './tunnel/qr-overlay';
import { createAppTray } from './tray';
import { registerSettingsIpc, openSettingsWindow } from './settings-window';
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
import { bootstrapProfiles, parseProfileCliArg, getActiveMarker, loadProfile, syncActiveProfileUrlPresets, clearIpAllowlistForActiveProfile } from './profiles/bootstrap';
import { bootstrapGraphicsPresets } from './graphics/bootstrap-presets';
import { profileRuntimeStatePath } from './profiles/paths';
import { parsePconairCli } from './cli-options';
import { startWatchdog } from './watchdog-electron';

const cli = parsePconairCli(process.argv);
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

function syncDisplaysToStore(): void {
  const store = getStore();
  store.setState({ displays: snapshotDisplays() });
}

async function main() {
  validatePins(OPERATOR_PIN, ADMIN_PIN);
  const cliProfile = parseProfileCliArg(process.argv);
  const userData = app.getPath('userData');
  const settingsFile = appSettingsPath(userData);
  const appSettings = loadAppSettings(settingsFile);
  const port = resolvePort(process.env.PCONAIR_PORT, appSettings);
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

  const graphicsRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'graphics')
    : path.join(app.getAppPath(), 'graphics');

  const dispatchAction = createActionDispatcher({ store, auth, presets, cues: l3Cues });

  syncDisplaysToStore();
  screen.on('display-added', syncDisplaysToStore);
  screen.on('display-removed', syncDisplaysToStore);
  screen.on('display-metrics-changed', syncDisplaysToStore);

  function getDisplayPreference(): string | null {
    const id = getActiveMarker(boot.paths)?.id ?? boot.activeId;
    return loadProfile(boot.paths, id)?.displayPreference ?? null;
  }

  const slidesManager = createSlidesWindowManager({ store, getDisplayPreference });
  slidesManager.initialize();

  const urlManager = createUrlWindowManager({ store });
  urlManager.initialize();

  const l3Manager = createL3WindowManager({ store, themes: l3ThemeStore, cues: l3Cues, getDisplayPreference });
  l3Manager.initialize();

  const mediaLibraryManager = createMediaLibraryWindowManager({ store, media: mediaLibrary, getDisplayPreference });
  mediaLibraryManager.initialize();

  const tunnelManager = createTunnelManager({
    store,
    getLocalOrigin: () => `http://127.0.0.1:${port}`,
    resourcesPath: app.isPackaged ? process.resourcesPath : null,
  });
  const startTunnelFromSettings = (): void => {
    const s = loadAppSettings(settingsFile);
    tunnelManager.start({ token: s.tunnelToken, domain: s.tunnelDomain });
  };
  store.setState({
    tunnel: {
      ...store.getState().tunnel,
      enabled: appSettings.tunnelEnabled,
      pinRequired: appSettings.tunnelPinHash !== null,
    },
  });

  const server = createServer({
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    l3ThemeStore,
    l3FilesRoot,
    graphicsRoot,
    mediaLibrary,
    dispatchAction,
    port,
    getTunnelPinHash: () => loadAppSettings(settingsFile).tunnelPinHash,
    startTunnel: startTunnelFromSettings,
    stopTunnel: () => tunnelManager.stop(),
    saveTunnelSettings: (patch) => {
      saveAppSettings(settingsFile, patch);
    },
    showQrOverlay,
    hideQrOverlay,
    packagesRoot: (() => {
      const userPackages = path.join(userData, 'packages');
      fs.mkdirSync(userPackages, { recursive: true });
      // Bundled packages ship with the app (forge extraResource); user packages
      // load after them so a user folder can't shadow a bundled id.
      const bundled = app.isPackaged
        ? path.join(process.resourcesPath, 'bundled-packages')
        : path.join(app.getAppPath(), 'bundled-packages');
      return [bundled, userPackages];
    })(),
    profilePaths: boot.paths,
    getActiveProfileId: () => getActiveMarker(boot.paths)?.id ?? boot.activeId,
    onProfileActivate: () => {
      app.relaunch();
      app.exit(0);
    },
    trustForwardedFor: cli.trustForwardedFor,
    renderManualCue: (cue) => renderCueToPng(cue, l3ThemeStore.getThemeCss(cue.theme)),
  });
  let serverError: string | null = null;
  try {
    await server.listen();
    console.log(`PConAir server running on http://localhost:${port}`);
  } catch (err) {
    serverError =
      (err as NodeJS.ErrnoException).code === 'EADDRINUSE'
        ? `port ${port} is already in use`
        : String((err as Error).message ?? err);
    console.error(`PConAir server failed to start: ${serverError}`);
  }

  if (!serverError && appSettings.tunnelEnabled) {
    startTunnelFromSettings();
  }

  if (!serverError) {
    // Pre-authenticate the local Electron shell so tray-opened windows skip the PIN prompt.
    const opSession = auth.createTrustedSession('operator');
    await session.defaultSession.cookies.set({
      url: `http://localhost:${port}`,
      name: 'pconair_operator_session',
      value: opSession.id,
      httpOnly: true,
      expirationDate: Math.floor(opSession.expiresAt / 1000),
    });
  }

  registerSettingsIpc({
    runningPort: port,
    serverError: () => serverError,
    profilePaths: boot.paths,
    getActiveProfileId: () => getActiveMarker(boot.paths)?.id ?? boot.activeId,
  });

  // Appliance model: no windows at boot. The tray is the only persistent UI;
  // operators use the web GUI from a browser.
  createAppTray({
    port,
    serverError,
    onOpenSettings: () => openSettingsWindow(),
    onOpenOperatorWindow: () => createOperatorWindow(port),
  });

  if (serverError) {
    // Surface the problem immediately so the port can be fixed without a terminal.
    openSettingsWindow();
  }
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('Failed to start PC On Air:', err);
  app.exit(1);
});

// Tray app: closing windows must not stop the server. Quit only via the tray menu.
app.on('window-all-closed', () => {
  /* keep running */
});
