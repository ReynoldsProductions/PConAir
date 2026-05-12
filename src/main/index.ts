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
import { createL3WindowManager } from './l3/window-manager';
import { createActionDispatcher } from './action-dispatch';
import { wireRuntimePersistence } from './runtime-persistence';
import { snapshotDisplays } from './displays';

const DEFAULT_PORT = parseInt(process.env.PCONAIR_PORT ?? '8080', 10);
const OPERATOR_PIN = process.env.PCONAIR_OPERATOR_PIN ?? '0000';
const ADMIN_PIN = process.env.PCONAIR_ADMIN_PIN ?? '00000000';

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
  const store = getStore();
  const auth = createAuthManager({
    operatorPin: OPERATOR_PIN,
    adminPin: ADMIN_PIN,
    operatorSessionMs: 8 * 60 * 60 * 1000,
    adminSessionMs: 4 * 60 * 60 * 1000,
    maxFailures: 5,
    lockoutMs: 5 * 60 * 1000,
  });

  let markDirty: () => void = () => {};
  const presets = createPresetsStore(() => markDirty());
  const l3Cues = createL3CueStore(() => markDirty());
  const l3Playlists = createL3PlaylistStore(l3Cues, () => markDirty());
  const persistPath = path.join(app.getPath('userData'), 'runtime-state.json');
  markDirty = wireRuntimePersistence(persistPath, { presets, cues: l3Cues, playlists: l3Playlists }).markDirty;

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

  const server = createServer({
    store,
    auth,
    presets,
    l3Cues,
    l3Playlists,
    dispatchAction,
    port: DEFAULT_PORT,
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
