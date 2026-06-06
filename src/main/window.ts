import { BrowserWindow, screen } from 'electron';

export interface WindowConfig {
  fullscreen?: boolean;
  displayId?: string; // Electron display id
}

export function createProgramWindow(config: WindowConfig = {}): BrowserWindow {
  const targetDisplay = config.displayId
    ? screen.getAllDisplays().find((d) => String(d.id) === config.displayId)
    : screen.getPrimaryDisplay();
  const display = targetDisplay ?? screen.getPrimaryDisplay();
  const { x, y } = display.bounds;

  const win = new BrowserWindow({
    x,
    y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: config.fullscreen ?? false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#000000',
    frame: false,
    show: false,
  });

  win.loadURL('about:blank');
  win.once('ready-to-show', () => win.show());
  return win;
}

export function createOperatorWindow(serverPort: number): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    title: 'PC On Air — Operator',
    show: false,
  });

  // Trailing slash so relative script URLs from HtmlWebpackPlugin resolve under /operator/
  win.loadURL(`http://localhost:${serverPort}/operator/`);
  win.once('ready-to-show', () => win.show());
  return win;
}
