import { Tray, Menu, nativeImage, shell, app } from 'electron';
import os from 'os';

// 16×16 PNG, dark rounded square with a red on-air dot (generated, embedded to avoid binary assets).
const TRAY_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAN0lEQVR4nGNgoBaQkpL6TwqmSDOGIYPbgKeWpuQZANKIjulnADbN2AwZxF6gSizQNyFRnJkoAQCmlBdhZhfnBgAAAABJRU5ErkJggg==';

export interface TrayDeps {
  port: number;
  /** null while the HTTP server failed to start (e.g. port in use). */
  serverError: string | null;
  onOpenSettings: () => void;
  onOpenOperatorWindow: () => void;
}

let tray: Tray | null = null;

export function createAppTray(deps: TrayDeps): Tray {
  const icon = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_BASE64}`);
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('PConAir');
  updateTrayMenu(deps);
  return tray;
}

export function updateTrayMenu(deps: TrayDeps): void {
  if (!tray) return;
  const hostname = os.hostname();
  const statusLabel = deps.serverError
    ? `Server error: ${deps.serverError}`
    : `Running — http://${hostname}:${deps.port}`;

  const menu = Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    {
      label: 'Open Web GUI',
      enabled: !deps.serverError,
      click: () => shell.openExternal(`http://localhost:${deps.port}/remote/`),
    },
    {
      label: 'Open Operator Window (local)',
      enabled: !deps.serverError,
      click: deps.onOpenOperatorWindow,
    },
    {
      label: 'Open Admin Dashboard',
      enabled: !deps.serverError,
      click: () => shell.openExternal(`http://localhost:${deps.port}/admin`),
    },
    { type: 'separator' },
    { label: 'Settings…', click: deps.onOpenSettings },
    { type: 'separator' },
    { label: 'Quit PConAir', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}
