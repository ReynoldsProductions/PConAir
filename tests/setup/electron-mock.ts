import { vi } from 'vitest';

// Consuming test files: do NOT `import { electronMock } from './setup/electron-mock'`
// at top level and keep using that binding after calling `vi.resetModules()`.
// resetModules() also invalidates this module's own cached instance as seen
// through the `vi.mock('electron', async () => (await import('./setup/electron-mock'))...)`
// factory, so a subsequent dynamic import of the module under test picks up
// a second, disconnected copy of this file's `electronMock`/`electronModule`
// singletons. Call `vi.resetModules()` first, then
// `const { electronMock } = await import('./setup/electron-mock')` inside
// the test body (or in a `beforeEach` that also re-imports the module under
// test), so both references land in the same module-cache epoch.

export interface RecordedWindow {
  options: Record<string, unknown>;
  loadedUrl: string | null;
  calls: string[];
  destroyed: boolean;
  webContents: FakeWebContents;
}

export const electronMock = {
  windows: [] as RecordedWindow[],
  trays: [] as Array<{ tooltip: string | null; menuLabels: string[] }>,
  partitionsRequested: [] as string[],
  ipcChannels: [] as string[],
  exposed: {} as Record<string, unknown>,
  displays: [
    { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1055 }, label: 'primary', scaleFactor: 2 },
    { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 }, workArea: { x: 1920, y: 0, width: 1920, height: 1080 }, label: 'NV-32-H-3', scaleFactor: 1 },
  ],
  reset() {
    this.windows.length = 0;
    this.trays.length = 0;
    this.partitionsRequested.length = 0;
    this.ipcChannels.length = 0;
    this.exposed = {};
  },
};

export class FakeWebContents {
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  constructor(private rec: RecordedWindow) {}
  on(event: string, fn: (...a: unknown[]) => void) {
    this.rec.calls.push(`webContents.on:${event}`);
    const list = this.handlers.get(event) ?? [];
    list.push(fn);
    this.handlers.set(event, list);
    return this;
  }
  once(event: string, fn: (...a: unknown[]) => void) { return this.on(event, fn); }
  /** Test-only: drive an event the source subscribed to. */
  emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers.get(event) ?? []) fn({ preventDefault() {} }, ...args);
  }
  hasHandler(event: string) { return (this.handlers.get(event) ?? []).length > 0; }
  send(channel: string) { this.rec.calls.push(`webContents.send:${channel}`); }
  executeJavaScript(code: string) { this.rec.calls.push('executeJavaScript'); void code; return Promise.resolve(); }
  insertCSS() { this.rec.calls.push('insertCSS'); return Promise.resolve(''); }
  setAudioMuted() { this.rec.calls.push('setAudioMuted'); }
  setWindowOpenHandler() { this.rec.calls.push('setWindowOpenHandler'); }
  openDevTools() { this.rec.calls.push('openDevTools'); }
  isLoading() { return false; }
  getURL() { return this.rec.loadedUrl ?? ''; }
}

export class FakeBrowserWindow {
  webContents: FakeWebContents;
  private rec: RecordedWindow;
  constructor(options: Record<string, unknown> = {}) {
    this.rec = { options, loadedUrl: null, calls: [], destroyed: false, webContents: null as unknown as FakeWebContents };
    this.webContents = new FakeWebContents(this.rec);
    this.rec.webContents = this.webContents;
    electronMock.windows.push(this.rec);
  }
  static getAllWindows() { return []; }
  loadURL(url: string) { this.rec.loadedUrl = url; return Promise.resolve(); }
  loadFile(p: string) { this.rec.loadedUrl = `file://${p}`; return Promise.resolve(); }
  on(event: string) { this.rec.calls.push(`on:${event}`); return this; }
  once(event: string) { this.rec.calls.push(`once:${event}`); return this; }
  show() { this.rec.calls.push('show'); }
  showInactive() { this.rec.calls.push('showInactive'); }
  hide() { this.rec.calls.push('hide'); }
  focus() { this.rec.calls.push('focus'); }
  close() { this.rec.calls.push('close'); }
  destroy() { this.rec.destroyed = true; }
  isDestroyed() { return this.rec.destroyed; }
  isVisible() { return true; }
  setBounds(b: unknown) { this.rec.calls.push(`setBounds:${JSON.stringify(b)}`); }
  getBounds() { return { x: 0, y: 0, width: 1920, height: 1080 }; }
  setFullScreen(v: boolean) { this.rec.calls.push(`setFullScreen:${v}`); }
  setAlwaysOnTop(v: boolean) { this.rec.calls.push(`setAlwaysOnTop:${v}`); }
  setIgnoreMouseEvents(v: boolean) { this.rec.calls.push(`setIgnoreMouseEvents:${v}`); }
  setMenuBarVisibility() { this.rec.calls.push('setMenuBarVisibility'); }
  setVisibleOnAllWorkspaces() { this.rec.calls.push('setVisibleOnAllWorkspaces'); }
  /** Test-only accessor. */
  get recorded() { return this.rec; }
}

export function fakeSessionFor(partition: string) {
  return {
    partition,
    cookies: { set: vi.fn().mockResolvedValue(undefined), get: vi.fn().mockResolvedValue([]) },
    fetch: vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: () => Promise.resolve(''),
      json: () => Promise.resolve({}),
    }),
    clearStorageData: vi.fn().mockResolvedValue(undefined),
    setPermissionRequestHandler: vi.fn(),
    webRequest: { onBeforeSendHeaders: vi.fn(), onHeadersReceived: vi.fn() },
  };
}

export const electronModule = {
  app: {
    getPath: vi.fn(() => '/tmp/pconair-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
    getName: vi.fn(() => 'PConAir'),
    getAppPath: vi.fn(() => '/tmp/pconair-test-app'),
    on: vi.fn(),
    once: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn(),
    exit: vi.fn(),
    relaunch: vi.fn(),
    dock: { hide: vi.fn(), show: vi.fn() },
    setLoginItemSettings: vi.fn(),
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
  },
  BrowserWindow: FakeBrowserWindow,
  session: {
    defaultSession: fakeSessionFor('default'),
    fromPartition: vi.fn((p: string) => {
      electronMock.partitionsRequested.push(p);
      return fakeSessionFor(p);
    }),
  },
  screen: {
    getAllDisplays: vi.fn(() => electronMock.displays),
    getPrimaryDisplay: vi.fn(() => electronMock.displays[0]),
    getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
    getDisplayNearestPoint: vi.fn(() => electronMock.displays[0]),
    on: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn((channel: string) => { electronMock.ipcChannels.push(`handle:${channel}`); }),
    on: vi.fn((channel: string) => { electronMock.ipcChannels.push(`on:${channel}`); }),
    removeHandler: vi.fn(),
  },
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    on: vi.fn(),
  },
  contextBridge: {
    exposeInMainWorld: vi.fn((key: string, api: unknown) => { electronMock.exposed[key] = api; }),
  },
  Tray: class {
    constructor() { electronMock.trays.push({ tooltip: null, menuLabels: [] }); }
    setToolTip(t: string) { electronMock.trays[electronMock.trays.length - 1].tooltip = t; }
    setContextMenu(menu: { items?: Array<{ label: string }> } | null) {
      electronMock.trays[electronMock.trays.length - 1].menuLabels = (menu?.items ?? []).map((i) => i.label);
    }
    setImage() {}
    on() { return this; }
    destroy() {}
  },
  Menu: { buildFromTemplate: vi.fn((t: Array<{ label: string }>) => ({ items: t })) },
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined), showItemInFolder: vi.fn() },
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => false, resize: vi.fn(() => ({})) })),
    createFromDataURL: vi.fn(() => ({ isEmpty: () => false, setTemplateImage: vi.fn() })),
  },
};
