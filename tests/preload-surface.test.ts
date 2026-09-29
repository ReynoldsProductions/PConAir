import { describe, it, expect, vi } from 'vitest';

// Hoisted by vitest within THIS file. The factory pulls the shared fake.
vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

// Both preload files are pure `contextBridge.exposeInMainWorld` side effects
// at import time -- no module-level state to reset between tests, so a
// single static top-level import (collection-time) of each is enough. This
// avoids the per-test `vi.resetModules()` + dynamic-reimport pattern the
// plan drafted: that pattern exists to force a fresh module instance when a
// module's behavior depends on being re-evaluated, which isn't the case
// here, and Tasks 3/4 found it desyncs the mock factory's cached instance in
// a multi-test file (see tests/electron-chrome-windows.test.ts).
import { electronMock, electronModule } from './setup/electron-mock';
import '../src/renderer/settings-preload';
import '../src/renderer/director-preload';

// The plan's draft asserted each namespace in isolation (`toHaveLength(1)`),
// which assumed a fresh module reload per test. Importing both files
// together instead lets this assert the *complete* set of what got exposed
// across both preloads in one go -- equally strong a check that nothing
// beyond the two expected namespaces leaks onto `window`.
describe('preload contextBridge surfaces', () => {
  it('exposes exactly pconairSettings and pconairDirector', () => {
    expect(Object.keys(electronMock.exposed).sort()).toEqual(['pconairDirector', 'pconairSettings']);
  });

  describe('settings preload', () => {
    const api = () => electronMock.exposed.pconairSettings as Record<string, unknown>;

    it('exposes the full settings API method list', () => {
      expect(Object.keys(api()).sort()).toEqual(['get', 'restart', 'savePort', 'saveSecurity']);
      for (const method of Object.values(api())) expect(typeof method).toBe('function');
    });

    it('proxies saveSecurity through ipcRenderer.invoke on the settings channel', async () => {
      const security = { ipAllowlistEnabled: true, ipAllowlist: ['10.0.0.1'] };
      await (api().saveSecurity as (s: unknown) => Promise<unknown>)(security);
      expect(electronModule.ipcRenderer.invoke).toHaveBeenCalledWith('pconair:settings:save-security', security);
    });
  });

  describe('director preload', () => {
    const api = () => electronMock.exposed.pconairDirector as Record<string, unknown>;

    it('exposes the full director API method list', () => {
      expect(Object.keys(api()).sort()).toEqual(['fireAction', 'listOffices', 'onOfficeState', 'onOfficeStatus']);
      for (const method of Object.values(api())) expect(typeof method).toBe('function');
    });

    it('proxies fireAction through ipcRenderer.invoke, defaulting body to {}', async () => {
      await (api().fireAction as (o: string, a: string) => Promise<unknown>)('officeA', 'slides_next');
      expect(electronModule.ipcRenderer.invoke).toHaveBeenCalledWith('pconair:director:fire-action', {
        officeId: 'officeA',
        action: 'slides_next',
        body: {},
      });
    });

    it('subscribes and unsubscribes office-status via ipcRenderer.on/removeListener', () => {
      const cb = vi.fn();
      const unsubscribe = (api().onOfficeStatus as (fn: unknown) => () => void)(cb);

      expect(electronModule.ipcRenderer.on).toHaveBeenCalledWith('pconair:director:office-status', expect.any(Function));
      const [, listener] = (electronModule.ipcRenderer.on as ReturnType<typeof vi.fn>).mock.calls.at(-1) as [string, (...a: unknown[]) => void];

      listener({}, { officeId: 'officeA', status: 'online' });
      expect(cb).toHaveBeenCalledWith('officeA', 'online');

      unsubscribe();
      expect(electronModule.ipcRenderer.removeListener).toHaveBeenCalledWith('pconair:director:office-status', listener);
    });
  });
});
