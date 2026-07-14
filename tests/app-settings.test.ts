import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  DEFAULT_APP_SETTINGS,
  appSettingsPath,
  loadAppSettings,
  saveAppSettings,
  resolvePort,
} from '../src/main/app-settings';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pconair-settings-'));
  file = appSettingsPath(dir);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadAppSettings', () => {
  it('returns defaults when the file is missing', () => {
    expect(loadAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('returns defaults when the file is corrupt JSON', () => {
    fs.writeFileSync(file, '{not json');
    expect(loadAppSettings(file)).toEqual(DEFAULT_APP_SETTINGS);
  });

  it('falls back to the default port for invalid port values', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, port: 'eighty' }));
    expect(loadAppSettings(file).port).toBe(8080);
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, port: 70000 }));
    expect(loadAppSettings(file).port).toBe(8080);
  });

  it('round-trips a saved port', () => {
    saveAppSettings(file, { port: 8123 });
    expect(loadAppSettings(file).port).toBe(8123);
  });
});

describe('saveAppSettings', () => {
  it('creates the directory and file on first save', () => {
    const nested = path.join(dir, 'deep', 'app-settings.json');
    const result = saveAppSettings(nested, { port: 9000 });
    expect(result.port).toBe(9000);
    expect(JSON.parse(fs.readFileSync(nested, 'utf-8')).port).toBe(9000);
  });

  it('ignores invalid ports in the patch and keeps the current value', () => {
    saveAppSettings(file, { port: 8123 });
    const result = saveAppSettings(file, { port: 0 });
    expect(result.port).toBe(8123);
  });
});

describe('resolvePort', () => {
  it('prefers a valid env value over the settings file', () => {
    expect(resolvePort('9001', { ...DEFAULT_APP_SETTINGS, port: 8123 })).toBe(9001);
  });

  it('falls back to settings when env is unset or invalid', () => {
    expect(resolvePort(undefined, { ...DEFAULT_APP_SETTINGS, port: 8123 })).toBe(8123);
    expect(resolvePort('nope', { ...DEFAULT_APP_SETTINGS, port: 8123 })).toBe(8123);
  });
});

describe('operationMode', () => {
  it('defaults to standalone when the field is missing', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, port: 8080 }));
    expect(loadAppSettings(file).operationMode).toBe('standalone');
  });

  it('accepts primary, backup, and standalone', () => {
    for (const mode of ['primary', 'backup', 'standalone'] as const) {
      fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, operationMode: mode }));
      expect(loadAppSettings(file).operationMode).toBe(mode);
    }
  });

  it('falls back to standalone for an invalid value', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, operationMode: 'leader' }));
    expect(loadAppSettings(file).operationMode).toBe('standalone');
  });

  it('round-trips operationMode through save', () => {
    saveAppSettings(file, { operationMode: 'primary' });
    expect(loadAppSettings(file).operationMode).toBe('primary');
  });

  it('ignores invalid operationMode in patch and keeps current value', () => {
    saveAppSettings(file, { operationMode: 'backup' });
    const result = saveAppSettings(file, { operationMode: 'bad-value' as never });
    expect(result.operationMode).toBe('backup');
  });
});

describe('backupIps', () => {
  it('defaults to empty array when the field is missing', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1 }));
    expect(loadAppSettings(file).backupIps).toEqual([]);
  });

  it('round-trips a non-empty backupIps array', () => {
    saveAppSettings(file, { backupIps: ['192.168.1.10', '192.168.1.11'] });
    expect(loadAppSettings(file).backupIps).toEqual(['192.168.1.10', '192.168.1.11']);
  });

  it('falls back to empty array when backupIps is not a string array', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, backupIps: [1, 2, 3] }));
    expect(loadAppSettings(file).backupIps).toEqual([]);

    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, backupIps: 'single' }));
    expect(loadAppSettings(file).backupIps).toEqual([]);
  });

  it('ignores invalid backupIps in patch and keeps current value', () => {
    saveAppSettings(file, { backupIps: ['10.0.0.1'] });
    const result = saveAppSettings(file, { backupIps: 'bad' as never });
    expect(result.backupIps).toEqual(['10.0.0.1']);
  });
});

describe('launchAtLogin', () => {
  it('defaults to false when the field is missing', () => {
    expect(loadAppSettings(file).launchAtLogin).toBe(false);
  });

  it('falls back to false for a non-boolean value', () => {
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, launchAtLogin: 'yes' }));
    expect(loadAppSettings(file).launchAtLogin).toBe(false);
  });

  it('round-trips true through save', () => {
    saveAppSettings(file, { launchAtLogin: true });
    expect(loadAppSettings(file).launchAtLogin).toBe(true);
  });

  it('round-trips back to false through save', () => {
    saveAppSettings(file, { launchAtLogin: true });
    saveAppSettings(file, { launchAtLogin: false });
    expect(loadAppSettings(file).launchAtLogin).toBe(false);
  });
});
