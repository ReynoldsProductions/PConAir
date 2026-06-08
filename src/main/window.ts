import { BrowserWindow } from 'electron';

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
