import { app, BrowserWindow } from 'electron';
import { createProgramWindow } from './window';
import { createServer } from './server';
import { getStore } from './state';
import { createAuthManager } from './auth';

const DEFAULT_PORT = parseInt(process.env.PCONAIR_PORT ?? '8080', 10);
const OPERATOR_PIN = process.env.PCONAIR_OPERATOR_PIN ?? '0000';
const ADMIN_PIN = process.env.PCONAIR_ADMIN_PIN ?? '00000000';

let programWindow: BrowserWindow | null = null;

async function main() {
  const store = getStore();
  const auth = createAuthManager({
    operatorPin: OPERATOR_PIN,
    adminPin: ADMIN_PIN,
    operatorSessionMs: 8 * 60 * 60 * 1000,
    adminSessionMs: 4 * 60 * 60 * 1000,
    maxFailures: 5,
    lockoutMs: 5 * 60 * 1000,
  });

  const server = createServer({ store, auth, port: DEFAULT_PORT });
  await server.listen();
  console.log(`PC On Air server running on http://localhost:${DEFAULT_PORT}`);

  programWindow = createProgramWindow({ fullscreen: false });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      programWindow = createProgramWindow({ fullscreen: false });
    }
  });
}

app.whenReady().then(main);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
