import { app, BrowserWindow } from 'electron';
import { createProgramWindow, createOperatorWindow } from './window';
import { createServer } from './server';
import { getStore } from './state';
import { createAuthManager } from './auth';
import { createPresetsStore } from './presets';
import { createSlidesWindowManager } from './slides/window-manager';
import { createUrlWindowManager } from './url/window-manager';

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
  const presets = createPresetsStore();

  const slidesManager = createSlidesWindowManager({ store });
  slidesManager.initialize();

  const urlManager = createUrlWindowManager({ store });
  urlManager.initialize();

  const server = createServer({ store, auth, presets, port: DEFAULT_PORT });
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
