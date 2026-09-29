import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('electron', async () => (await import('./setup/electron-mock')).electronModule);

import { electronMock, electronModule } from './setup/electron-mock';
import { applyLaunchAtLogin } from '../src/main/launch-at-login';

beforeEach(() => {
  electronMock.reset();
  electronModule.app.isPackaged = false;
});

afterEach(() => {
  electronModule.app.isPackaged = false;
});

describe('applyLaunchAtLogin', () => {
  it('is a no-op when the app is not packaged (dev/electron-forge start)', () => {
    applyLaunchAtLogin(true);
    expect(electronModule.app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it('sets openAtLogin on a packaged build, without the removed openAsHidden option', () => {
    electronModule.app.isPackaged = true;
    applyLaunchAtLogin(true);
    expect(electronModule.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it('passes enabled=false through unchanged', () => {
    electronModule.app.isPackaged = true;
    applyLaunchAtLogin(false);
    expect(electronModule.app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });
});
